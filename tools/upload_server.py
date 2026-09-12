#!/usr/bin/env python3
"""Tiny asset upload dropbox for the sandbox preview.

GET  /            -> drag & drop page
PUT  /upload/<n>  -> save an asset, or validate and save a *.skill.json/*.ability.json
GET  /list        -> JSON list of uploaded files
GET  /files       -> same, with byte sizes (Hero Studio library picker)
GET  /skills      -> uploaded skill/ability manifests with validation reports
GET  /skill/<n>   -> read one validated uploaded manifest
GET  /config      -> models/uploads/hero_tuning.json
POST /validate    -> validate a manifest without saving it

Models, videos, browser-decodable audio (OGG/WAV/MP3/M4A/AAC/OPUS/FLAC), and
validated skill/ability manifests are accepted so Hero Studio can keep visual
VFX, gameplay metadata, and optional sample cues together.

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
SAFE = re.compile(r"^[\w][\w.\-]{0,120}\.(glb|gltf|mp4|webm|ogv|ogg|wav|mp3|m4a|aac|opus|flac|skill\.json|ability\.json)$", re.I)
MANIFEST_KINDS = {"neon-vanguard-skill", "neon-vanguard-ability"}
REGISTERED_IDS = {"solar", "solar-flare", "prism", "prism-burst"}
HERO_IDS = {"aegis", "nyx", "lyra"}
SLOT_KEYS = {"Q", "E", "R", "F", "V", "X", "B"}
TARGETING = {"line", "zone", "point", "self", "cone"}
MAX = 200 * 1024 * 1024
MANIFEST_MAX = 1024 * 1024


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and value not in (float("inf"), float("-inf"))


def validate_manifest(data):
    """Return a structural report; never imports or executes implementation paths."""
    errors = []
    warnings = []
    if not isinstance(data, dict):
        return {"valid": False, "registered": False, "errors": [{"path": "$", "message": "manifest must be a JSON object"}], "warnings": []}

    def error(path, message):
        errors.append({"path": path, "message": message})

    def warning(path, message):
        warnings.append({"path": path, "message": message})

    if data.get("kind") not in MANIFEST_KINDS:
        error("kind", "must be neon-vanguard-skill or neon-vanguard-ability")
    if data.get("version") != 1:
        error("version", "must be version 1")
    skill_id = data.get("id")
    if not isinstance(skill_id, str) or not re.match(r"^[a-z0-9][a-z0-9-]{1,63}$", skill_id):
        error("id", "must use 2-64 lowercase letters, numbers, or hyphens")
    if not isinstance(data.get("label"), str) or len(data["label"].strip()) < 2:
        error("label", "must be a descriptive string")

    input_data = data.get("input")
    if not isinstance(input_data, dict):
        error("input", "is required")
    else:
        if input_data.get("key") is not None and input_data["key"] not in SLOT_KEYS:
            error("input.key", "must be a known input key")
        if input_data.get("targeting") is not None and input_data["targeting"] not in TARGETING:
            error("input.targeting", "must be line, zone, point, self, or cone")
        for field in ("range", "minRange"):
            if field in input_data and not _finite(input_data[field]):
                error(f"input.{field}", "must be finite")

    timing = data.get("timing")
    if not isinstance(timing, dict):
        error("timing", "is required")
    else:
        for field in ("cooldown", "castTime", "travelTime", "impactTime", "holdTime", "fadeTime"):
            if field in timing and (not _finite(timing[field]) or timing[field] < 0):
                error(f"timing.{field}", "must be a non-negative finite number")

    phases = data.get("phases")
    if not isinstance(phases, list) or not phases:
        error("phases", "must contain at least one phase")
    else:
        for index, phase in enumerate(phases):
            if not isinstance(phase, dict):
                error(f"phases[{index}]", "must be an object")
                continue
            if not isinstance(phase.get("id"), str) or not phase["id"].strip():
                error(f"phases[{index}].id", "is required")
            if "duration" in phase and (not _finite(phase["duration"]) or phase["duration"] < 0):
                error(f"phases[{index}].duration", "must be a non-negative finite number")

    for field in ("gameplay", "vfxProfile"):
        if field in data and not isinstance(data[field], dict):
            error(field, "must be an object")
    assignments = data.get("assignments")
    if assignments is not None:
        if not isinstance(assignments, dict):
            error("assignments", "must be an object")
        else:
            for hero_id, slot in assignments.items():
                if hero_id not in HERO_IDS:
                    error(f"assignments.{hero_id}", "unknown hero ID")
                if slot is not None and slot not in SLOT_KEYS:
                    error(f"assignments.{hero_id}", "must be a known slot or null")
    implementation = data.get("implementation")
    if implementation is not None and not isinstance(implementation, dict):
        error("implementation", "must be an object")
    elif isinstance(implementation, dict):
        warning("implementation", "metadata only; upload never executes implementation paths")
    if "vfxProfile" not in data:
        warning("vfxProfile", "no VFX profile supplied; runtime defaults will be used")
    if "gameplay" not in data:
        warning("gameplay", "no gameplay payload supplied; manifest remains VFX/design-only")

    registered = skill_id in REGISTERED_IDS
    if not registered and not errors:
        warning("id", "valid manifest, but runtime registration is required before it is playable")
    return {"valid": not errors, "registered": registered, "errors": errors, "warnings": warnings}


def is_manifest_name(name):
    return name.lower().endswith((".skill.json", ".ability.json"))


def skill_reports():
    reports = []
    if not os.path.isdir(UPDIR):
        return reports
    for name in sorted(os.listdir(UPDIR)):
        if not is_manifest_name(name):
            continue
        path = os.path.join(UPDIR, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            report = validate_manifest(data)
            report.update({
                "name": name,
                "id": data.get("id"),
                "label": data.get("label"),
                "bytes": os.path.getsize(path),
                "mtime": os.stat(path).st_mtime_ns,
            })
        except Exception as exc:
            report = {
                "name": name,
                "valid": False,
                "registered": False,
                "errors": [{"path": "$", "message": f"invalid JSON: {exc}"}],
                "warnings": [],
            }
        reports.append(report)
    return reports


PAGE = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Asset Upload — NEON VANGUARD</title>
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
 <h1>NEON VANGUARD &mdash; ASSET DROPBOX</h1>
 <p>Drag a model, video, audio, or <b>.skill.json / .ability.json</b> manifest here. Assets are saved into <b>models/uploads/</b>; manifests are validated first.</p>
 <label class=btn for=f>CHOOSE FILE</label><input id=f type=file accept=".glb,.gltf,.mp4,.webm,.ogv,.ogg,.wav,.mp3,.m4a,.aac,.opus,.flac,.skill.json,.ability.json,application/json">
 <div id=bar><i></i></div>
 <div id=msg></div>
 <div id=list></div>
</div>
<script>
const drop=document.getElementById('drop'),bar=document.getElementById('bar'),fill=bar.firstElementChild,msg=document.getElementById('msg'),listEl=document.getElementById('list');
function viewerLink(name){return 'https://'+location.hostname.replace(/^\\d+-/,'8080-')+'/character-bay.html';}
function refresh(){Promise.all([fetch('/list').then(r=>r.json()),fetch('/skills').then(r=>r.json())]).then(([fs,skills])=>{listEl.innerHTML='';if(skills.length){const h=document.createElement('p');h.textContent='Uploaded skill / ability manifests:';listEl.appendChild(h);skills.forEach(s=>{const a=document.createElement('a');a.href='#';a.textContent='\\u25b8 '+s.name+'  ['+(s.valid?(s.registered?'REGISTERED':'VALID · REVIEW-ONLY'):'INVALID')+']';a.onclick=e=>e.preventDefault();a.style.color=s.valid?(s.registered?'#3dffb0':'#ffb14a'):'#ff3b5c';listEl.appendChild(a);});}const assets=fs.filter(n=>!/(\\.skill|\\.ability)\\.json$/i.test(n));if(assets.length){const h=document.createElement('p');h.textContent='Other workspace assets:';listEl.appendChild(h);assets.forEach(n=>{const a=document.createElement('a');a.href=viewerLink(n);a.textContent='\\u25b8 '+n+'  (open in viewer)';a.target='_blank';listEl.appendChild(a);});}}).catch(()=>{});}
async function upload(file){
 if(!file)return;
 const manifest=/\\.(skill|ability)\\.json$/i.test(file.name);
 if(!manifest && !/\\.(glb|gltf|mp4|webm|ogv|ogg|wav|mp3|m4a|aac|opus|flac)$/i.test(file.name)){msg.style.color='#ff3b5c';msg.textContent='Unsupported file type.';return;}
 if(manifest){
  let data;
  try{data=JSON.parse(await file.text());}catch(e){msg.style.color='#ff3b5c';msg.textContent='Manifest rejected: invalid JSON.';return;}
  msg.style.color='#ffb14a';msg.textContent='Validating '+file.name+' \\u2026';
  try{
   const vr=await fetch('/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   const report=await vr.json();
   if(!vr.ok||!report.valid){msg.style.color='#ff3b5c';msg.textContent='Manifest rejected: '+(report.errors||[]).map(e=>e.path+' '+e.message).join('; ');return;}
   msg.textContent='Validated '+(data.label||data.id)+' \\u2713 '+(report.registered?'registered':'review-only, code registration required')+' · uploading \\u2026';
  }catch(e){msg.style.color='#ff3b5c';msg.textContent='Validation failed (network).';return;}
 } else {msg.style.color='#3dffb0';msg.textContent='Uploading '+file.name+' \\u2026';}
 bar.style.display='block';fill.style.width='0';
 const xhr=new XMLHttpRequest();
 xhr.open('PUT','/upload/'+encodeURIComponent(file.name));
 xhr.upload.onprogress=e=>{if(e.lengthComputable)fill.style.width=(e.loaded/e.total*100)+'%';};
 xhr.onload=()=>{ let result={}; try{result=JSON.parse(xhr.responseText);}catch(e){}
  if(xhr.status===200){msg.textContent=manifest?'Uploaded and validated '+file.name+' \\u2713':'Saved '+file.name+' \\u2713'; const a=document.createElement('a');a.href=viewerLink(file.name);a.textContent='\\u25b8 open '+file.name+' in model viewer';a.target='_blank';listEl.prepend(a); refresh(); }
  else {msg.style.color='#ff3b5c';msg.textContent='Upload failed: '+(result.error||'HTTP '+xhr.status);}
 };
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
        # the studio page lives on the :8080 origin — allow cross-origin saves
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/list":
            files = sorted(os.listdir(UPDIR)) if os.path.isdir(UPDIR) else []
            self._send(200, json.dumps(files).encode())
        elif self.path == "/files":
            # richer listing for the Hero Studio library picker: name + size
            out = []
            if os.path.isdir(UPDIR):
                for n in sorted(os.listdir(UPDIR)):
                    fp = os.path.join(UPDIR, n)
                    if os.path.isfile(fp):
                        out.append({"name": n, "bytes": os.path.getsize(fp), "mtime": os.stat(fp).st_mtime_ns})
            self._send(200, json.dumps(out).encode())
        elif self.path == "/skills":
            self._send(200, json.dumps(skill_reports()).encode())
        elif self.path.startswith('/skill/'):
            name = os.path.basename(unquote(self.path[len('/skill/'):]))
            path = os.path.join(UPDIR, name)
            if not is_manifest_name(name) or not os.path.isfile(path):
                self._send(404, b'{"error":"skill not found"}')
                return
            try:
                with open(path, "rb") as f:
                    self._send(200, f.read())
            except Exception:
                self._send(500, b'{"error":"skill read failed"}')
        elif self.path == "/config":


            p = os.path.join(UPDIR, "hero_tuning.json")
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    self._send(200, f.read())
            else:
                self._send(404, b"{}")
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path != "/validate":
            self._send(404, b'{"error":"not found"}')
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MANIFEST_MAX:
            self._send(413, json.dumps({"error": "bad manifest size"}).encode())
            return
        try:
            data = json.loads(self.rfile.read(length))
        except Exception:
            self._send(400, json.dumps({"valid": False, "registered": False, "errors": [{"path": "$", "message": "invalid JSON"}], "warnings": []}).encode())
            return
        self._send(200, json.dumps(validate_manifest(data)).encode())

    def do_PUT(self):
        if self.path == "/config":

            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > 1024 * 1024:
                self._send(413, json.dumps({"error": "bad size"}).encode())
                return
            try:
                cfg = json.loads(self.rfile.read(length))
                if not isinstance(cfg, dict):
                    raise ValueError("not an object")
            except Exception:
                self._send(400, json.dumps({"error": "invalid json"}).encode())
                return
            os.makedirs(UPDIR, exist_ok=True)
            with open(os.path.join(UPDIR, "hero_tuning.json"), "wb") as f:
                f.write(json.dumps(cfg, indent=2).encode())
            self._send(200, json.dumps({"ok": True}).encode())
            return
        m = re.match(r"^/upload/(.+)$", self.path)
        name = os.path.basename(unquote(m.group(1))) if m else ""
        if not SAFE.match(name):
            self._send(400, json.dumps({"error": "bad name; use a supported model, video, audio, .skill.json, or .ability.json extension"}).encode())
            return
        length = int(self.headers.get("Content-Length", 0))
        limit = MANIFEST_MAX if is_manifest_name(name) else MAX
        if length <= 0 or length > limit:
            self._send(413, json.dumps({"error": "bad size"}).encode())
            return
        body = self.rfile.read(length)
        validation = None
        if is_manifest_name(name):
            try:
                data = json.loads(body)
                validation = validate_manifest(data)
            except Exception:
                self._send(400, json.dumps({"error": "invalid manifest JSON"}).encode())
                return
            if not validation["valid"]:
                self._send(422, json.dumps({"error": "manifest validation failed", "validation": validation}).encode())
                return
            body = (json.dumps(data, indent=2) + "\n").encode()
        os.makedirs(UPDIR, exist_ok=True)
        with open(os.path.join(UPDIR, name), "wb") as f:
            f.write(body)
        response = {"ok": True, "name": name, "bytes": len(body)}
        if validation is not None:
            response.update({"kind": "manifest", "validation": validation})
        self._send(200, json.dumps(response).encode())

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs(UPDIR, exist_ok=True)
    print(f"upload server on :{PORT}, saving to {UPDIR}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
