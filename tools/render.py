#!/usr/bin/env python3
"""Rasterise a tools/charpreview.mjs JSON dump to a PNG, no browser.

Painter's-algorithm triangle fill + flat lambert shading + emissive.
Not pretty, but it shows the *real* silhouette and faceting, which is
exactly what art direction needs to iterate on.

Usage:  python3 tools/render.py <char-xxx.json> <out.png> [W H]
"""
import json, math, sys, zlib, struct

def norm3(v):
    l = math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) or 1.0
    return (v[0]/l, v[1]/l, v[2]/l)
def sub(a,b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def cross(a,b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def dot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]

def look_at(eye, target, up=(0,1,0)):
    f = norm3(sub(target, eye))
    r = norm3(cross(f, up))
    u = cross(r, f)
    return f, r, u

def main():
    src, out = sys.argv[1], sys.argv[2]
    W = int(sys.argv[3]) if len(sys.argv) > 3 else 420
    H = int(sys.argv[4]) if len(sys.argv) > 4 else 560
    data = json.load(open(src))
    tris = data['tris']; s = data.get('scale', 1.0)

    eye = (2.6*s, 1.9*s, 3.6*s)
    tgt = (0.0, 1.05*s, 0.0)
    f, r, u = look_at(eye, tgt)
    fov = math.radians(33)
    fl = 1.0/math.tan(fov/2)
    cx, cy = W/2, H/2

    key = norm3((0.55, 0.75, 0.5))
    key2 = norm3((-0.6, 0.2, -0.4))   # cool rim from behind-left

    buf = [[(6,7,12)]*W for _ in range(H)]   # near-black blue

    def project(p):
        d = sub(p, eye)
        x = dot(d, r); y = dot(d, u); z = dot(d, f)
        if z < 0.05: return None, z
        px = cx + x*fl/z*(H/2)
        py = cy - y*fl/z*(H/2)
        return (px, py), z

    polys = []
    for t in tris:
        v = t['v']
        A=(v[0],v[1],v[2]); B=(v[3],v[4],v[5]); C=(v[6],v[7],v[8])
        pa, za = project(A); pb, zb = project(B); pc, zc = project(C)
        if not (pa and pb and pc): continue
        depth = (za+zb+zc)/3.0
        polys.append((depth, pa, pb, pc, t))
    polys.sort(key=lambda p: -p[0])   # far first

    for depth, pa, pb, pc, t in polys:
        n = (t['n'][0], t['n'][1], t['n'][2])
        if t['glow']:
            c = [t['base'][i] * (0.6 + 1.6*t['op']) for i in range(3)]
        else:
            lam = max(0.0, dot(n, key))
            rim = max(0.0, dot(n, key2)) * 0.35
            amb = 0.30
            c = [t['base'][i]*(amb + 0.85*lam + rim) for i in range(3)]
            c = [c[i] + t['emis'][i]*t['ei'] for i in range(3)]
        # tonemap + gamma
        c = [ (x/(1.0+x)) ** (1/2.2) * 255 for x in c ]
        c = tuple(min(255, int(x)) for x in c)

        xs = [pa[0], pb[0], pc[0]]; ys = [pa[1], pb[1], pc[1]]
        x0, x1 = int(max(0,min(xs))), int(min(W-1, max(xs)+1))
        y0, y1 = int(max(0,min(ys))), int(min(H-1, max(ys)+1))
        def edge(a,b,p):
            return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])
        d0 = edge(pb,pc,pa) or 1; d1 = edge(pc,pa,pb) or 1; d2 = edge(pa,pb,pc) or 1
        for yy in range(y0, y1+1):
            row = buf[yy]
            for xx in range(x0, x1+1):
                p = (xx+0.5, yy+0.5)
                w0 = edge(pb,pc,p)/d0; w1 = edge(pc,pa,p)/d1; w2 = edge(pa,pb,p)/d2
                if w0 >= 0 and w1 >= 0 and w2 >= 0:
                    row[xx] = c

    raw = b''.join(b'\x00' + b''.join(struct.pack('3B', *px) for px in row) for row in buf)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6))
    png += chunk(b'IEND', b'')
    open(out, 'wb').write(png)
    print('wrote', out, W, 'x', H, len(polys), 'tris')

main()
