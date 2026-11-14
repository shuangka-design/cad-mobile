package com.example.cadmobile

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.WindowManager
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingBytes: ByteArray? = null

    // เปิดไฟล์ (.dxf / .dwg) ผ่านหน้าต่างเลือกไฟล์ของ Android
    private val openDoc = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    // บันทึกไฟล์ (ให้ผู้ใช้เลือกตำแหน่งและชื่อไฟล์)
    private val createDoc = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val bytes = pendingBytes
        pendingBytes = null
        if (uri == null || bytes == null) return@registerForActivityResult
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            Toast.makeText(this, "บันทึกไฟล์แล้ว", Toast.LENGTH_SHORT).show()
        } catch (e: IOException) {
            Toast.makeText(this, "บันทึกไม่สำเร็จ: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    // ฝั่ง JavaScript เรียกผ่าน window.AndroidBridge.saveFile(...)
    inner class Bridge {
        @JavascriptInterface
        fun saveFile(name: String, mime: String, base64: String) {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            runOnUiThread {
                pendingBytes = bytes
                createDoc.launch(name)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // เปิดหน้าจอค้างไว้ + ซ่อนแถบระบบให้เต็มจอ
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        // เปิดให้ debug ผ่าน chrome://inspect เฉพาะ debug build
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView = WebView(this)
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WasmAssetsHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                openDoc.launch(arrayOf("*/*"))
                return true
            }
        }

        // ทางสำรอง: ถ้ามีดาวน์โหลด blob: หลุดมาถึงตรงนี้ ให้ดึงข้อมูลแล้วบันทึก
        webView.setDownloadListener { url, _, contentDisposition, mimetype, _ ->
            if (url.startsWith("blob:")) {
                val name = URLUtil.guessFileName(url, contentDisposition, mimetype)
                webView.evaluateJavascript(
                    """
                    fetch('$url').then(r => r.blob()).then(b => {
                      const fr = new FileReader();
                      fr.onload = () => AndroidBridge.saveFile('$name', b.type || '$mimetype',
                                                               String(fr.result).split(',')[1]);
                      fr.readAsDataURL(b);
                    });
                    """.trimIndent(), null
                )
            }
        }

        // กันกด Back แล้วโปรแกรมปิดไปพร้อมงานที่ยังไม่ได้เซฟ
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage("ออกจากโปรแกรม? งานที่ยังไม่ได้บันทึกจะหายไป")
                    .setPositiveButton("ออก") { _, _ -> finish() }
                    .setNegativeButton("ยกเลิก", null)
                    .show()
            }
        })

        webView.loadUrl("https://appassets.androidplatform.net/assets/cadcraft/index.html")
    }
}
