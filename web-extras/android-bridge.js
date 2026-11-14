// android-bridge.js — ส่งไฟล์ที่โปรแกรม "ดาวน์โหลด" ไปให้ Android บันทึก
(function () {
  if (!window.AndroidBridge) return; // เปิดในเบราว์เซอร์ปกติ = ไม่ทำอะไร

  const blobs = new Map();
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    const url = origCreate(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  // หน่วงการลบ blob ไว้ 60 วินาที เพื่อให้มีเวลาอ่านข้อมูล
  URL.revokeObjectURL = function (url) {
    setTimeout(function () { blobs.delete(url); origRevoke(url); }, 60000);
  };

  function send(blob, name) {
    const reader = new FileReader();
    reader.onload = function () {
      const base64 = String(reader.result).split(',')[1] || '';
      window.AndroidBridge.saveFile(
        name || 'drawing.dxf',
        blob.type || 'application/octet-stream',
        base64
      );
    };
    reader.readAsDataURL(blob);
  }

  function tryIntercept(a) {
    if (!a || !a.href || !a.hasAttribute('download')) return false;
    if (a.href.startsWith('blob:') || a.href.startsWith('data:')) {
      const cached = blobs.get(a.href);
      if (cached) send(cached, a.download);
      else fetch(a.href).then(r => r.blob()).then(b => send(b, a.download));
      return true;
    }
    return false;
  }

  // กรณีโปรแกรมเรียก a.click() กับลิงก์ที่ไม่ได้อยู่บนหน้าเว็บ
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!tryIntercept(this)) origClick.call(this);
  };
  // กรณีกดลิงก์ที่อยู่บนหน้าเว็บ
  document.addEventListener('click', function (e) {
    const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && tryIntercept(a)) e.preventDefault();
  }, true);
})();
