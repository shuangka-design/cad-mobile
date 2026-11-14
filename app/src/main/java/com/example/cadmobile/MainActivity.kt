package com.example.cadmobile

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.IOException
import java.net.URLConnection

class WasmAssetsHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        return try {
            val stream = context.assets.open(path)
            val mime = when {
                path.endsWith(".wasm") -> "application/wasm"
                path.endsWith(".js")   -> "text/javascript"
                path.endsWith(".html") -> "text/html"
                path.endsWith(".css")  -> "text/css"
                path.endsWith(".json") -> "application/json"
                path.endsWith(".svg")  -> "image/svg+xml"
                path.endsWith(".ttf")  -> "font/ttf"
                path.endsWith(".otf")  -> "font/otf"
                else -> URLConnection.guessContentTypeFromName(path) ?: "application/octet-stream"
            }
            WebResourceResponse(mime, null, stream)
        } catch (e: IOException) {
            null
        }
    }
}
