#!/usr/bin/env python3
"""Tiny GLB upload dropbox for the sandbox preview.

GET  /            -> drag & drop page
PUT  /upload/<n>  -> save raw body to models/uploads/<n>
GET  /list        -> JSON list of uploaded files

Run: python3 tools/upload_server.py   (binds 0.0.0.0:8081)
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPDIR = os.path.join(REPO, "models", "uploads")
PORT = 8081
SAFE = re.compile(r"^[\w][\w.\-]{0,120}\.(glb|gltf)$", re.I)
MAX = 200 * 1024 * 1024

PAGE = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>GLB Upload — NEON VANGUARD</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070a12;color:#cfe6ff;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
 #drop{width:min(600px,92vw);padding:44px 28px;border:2px dashed #1e4b66;border-radius:14px;text-align:center;background:#0a1020}
 #drop.hot{border-color:#18e0ff;background:#0d1a2c}
 h1{font-size:16px;letter-spacing:.12em;color:#7cf9ff;margin:0 0 8px}
 p{margin:6px 0;color:#8fb0cc}
 #bar{height:6px;border-radius:3px;background:#122036;margin:18px auto 0;max-width:420px;overflow:hidden;display:none}
 #bar i{display:block;height:100%;width:0;background:#18e0ff}
 #msg{margin-top:14px;color:#3dffb0;word-break:break-all}
 #list{margin-top:18px;text-align:left;max-width:460px;margin-left:auto;margin-right:auto}
 #list a{color:#7cf9ff;display:block;padding:3px 0;word-break:break-all}
 input{display:none}
 label.btn{display:inline-block;margin-top:14px;padding:8px 18px;border:1px solid #1e4b66;border-radius:8px;color:#7cf9ff;cursor:pointer}
</style></head><body>
<div id=drop>
 <h1>NEON VANGUARD &mdash; GLB DROPBOX</h1>
 <p>Drag a .glb here (or click to browse). It is saved into the workspace at <b>models/uploads/</b>.</p>
 <label class=btn for=f>CHOOSE FILE</label><input id=f type=file accept=".glb,.gltf">
 <div id=bar><i></i></div>
 <div id=msg></div>
 <div id=list></div>
</div>
<script>
const drop=document.getElementById('drop'),bar=document.getElementById('bar'),fill=bar.firstElementChild,msg=document.getElementById('msg'),listEl=document.getElementById('list');
function viewerLink(name){return 'https://'+location.hostname.replace(/^\\d+-/,'8080-')+'/model-viewer.html?model='+encodeURIComponent('models/uploads/'+name);}
function refresh(){fetch('/list').then(r=>r.json()).then(fs=>{listEl.innerHTML=fs.length?'<p>In the workspace:</p>':'';fs.forEach(n=>{const a=document.createElement('a');a.href=viewerLink(n);a.textContent='\\u25b8 '+n+'  (open in viewer)';a.target='_blank';listEl.appendChild(a);});});}
function upload(file){
 if(!file)return;
 if(!/\\.(glb|gltf)$/i.test(file.name)){msg.style.color='#ff3b5c';msg.textContent='Only .glb / .gltf allowed.';return;}
 msg.style.color='#3dffb0';msg.textContent='Uploading '+file.name+' \\u2026';
 bar.style.display='block';fill.style.width='0';
 const xhr=new XMLHttpRequest();
 xhr.open('PUT','/upload/'+encodeURIComponent(file.name));
 xhr.upload.onprogress=e=>{if(e.lengthComputable)fill.style.width=(e.loaded/e.total*100)+'%';};
 xhr.onload=()=>{ if(xhr.status===200){msg.textContent='Saved '+file.name+' \\u2713'; const a=document.createElement('a');a.href=viewerLink(file.name);a.textContent='\\u25b8 open '+file.name+' in model viewer';a.target='_blank';listEl.prepend(a); refresh(); } else {msg.style.color='#ff3b5c';msg.textContent='Upload failed: HTTP '+xhr.status;} };
 xhr.onerror=()=>{msg.style.color='#ff3b5c';msg.textContent='Upload failed (network).';};
 xhr.send(file);
}
['dragover','dragenter'].forEach(ev=>addEventListener(ev,e=>{e.preventDefault();drop.classList.add('hot');}));
['dragleave','drop'].forEach(ev=>addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('hot');}));
addEventListener('drop',e=>upload(e.dataTransfer.files[0]));
document.getElementById('f').onchange=e=>upload(e.target.files[0]);
refresh();
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/list":
            files = sorted(os.listdir(UPDIR)) if os.path.isdir(UPDIR) else []
            self._send(200, json.dumps(files).encode())
        else:
            self._send(404, b'{"error":"not found"}')

    def do_PUT(self):
        m = re.match(r"^/upload/(.+)$", self.path)
        name = os.path.basename(unquote(m.group(1))) if m else ""
        if not SAFE.match(name):
            self._send(400, json.dumps({"error": "bad name; use *.glb or *.gltf"}).encode())
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX:
            self._send(413, json.dumps({"error": "bad size"}).encode())
            return
        body = self.rfile.read(length)
        os.makedirs(UPDIR, exist_ok=True)
        with open(os.path.join(UPDIR, name), "wb") as f:
            f.write(body)
        self._send(200, json.dumps({"ok": True, "name": name, "bytes": length}).encode())

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs(UPDIR, exist_ok=True)
    print(f"upload server on :{PORT}, saving to {UPDIR}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
