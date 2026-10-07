"""make_package_notices.py -- the Wonderland package's THIRD-PARTY NOTICES, built from the Unreal Engine's OWN third-party records
(CORE, 2026-10-07; the founder's ruling 10:57Z: "Preserve third-party software/license obligations independently of the project-level
proprietary license"; the Unreal Engine EULA's Third Party Software clause: "those terms or other attribution requirements can be
found in the installation directory for each engine version under the /Engine/Source/ThirdParty/Licenses sub-folder").

  python -I make_package_notices.py --tps-log <log> --engine <UE root> --out <NEW folder> --shipped <package folder>
  python -I make_package_notices.py --selftest

The log is UAT's `ListThirdPartySoftware -Target=Wonderland|Development|Win64` output: one .tps per line. A .tps is Epic's record of a
third-party component: <Name> (or, in the NNE records, a "Software Name:" comment; their <Name> is the filer), <Location>,
<LicenseFolder> (a license file under Engine/Source/ThirdParty/Licenses, or that folder itself), <Eula> (a URL). UAT lists every .tps
under the target's MODULE folders (the code linked into the game exe), its runtime-dependency folders, the engine Shaders and the
WHOLE engine Content folder: an OVER-inclusive list, the safe direction for notices. Added: the .tps Epic keeps BESIDE a shipped
binary (dbghelp, Aftermath), which UAT's module scan misses, and a named entry for the 3 shipped components the engine holds no
record for.

COMPLETENESS (SECOND's rule, 10-07): EVERY redistributed binary or font in the package (.dll .exe .ttf .otf .ttc .woff .woff2),
except the game's own exe and Epic's bootstrap exe, must map to a listed component or a named vendor-terms entry. An unmapped one is
a GAP: exit 1, so a build that calls this FAILS rather than ship a binary without its notice.

Writes ONLY into --out (refused if it exists): THIRD_PARTY_NOTICES.txt (UTF-8, CRLF), notices_map.json, SUMMARY.txt.
"""
import argparse
import json
import os
import re
import sys

REDIST_EXT = ('.dll', '.exe', '.ttf', '.otf', '.ttc', '.woff', '.woff2')
# the game itself (its linked libraries are the module records UAT lists) and Epic's generic bootstrap (Epic's own Licensed Technology)
OWN = ('Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe')
# (a shipped path pattern, the component it maps to: a STRICT regex on the record's name / location / path, or VENDOR = no engine
# record exists anywhere and the component is NAMED in the notices). Draft 1's loose 'pix' matched "Subpixel" and 'ogg' "logger".
SHIPPED_MAP = [
    (r'^Engine/Binaries/ThirdParty/DbgHelp/', r'\bdbghelp\b|windows 10 sdk'),
    (r'^Engine/Binaries/ThirdParty/MsQuic/', r'\bmsquic\b'),
    (r'^Engine/Binaries/ThirdParty/NVIDIA/NVaftermath/', r'\baftermath\b'),
    (r'^Engine/Binaries/ThirdParty/Ogg/', r'\bogg vorbis\b|[\\/]ogg[\\/]'),
    (r'^Engine/Binaries/ThirdParty/Vorbis/', r'\bvorbis\b'),
    (r'^Engine/Binaries/ThirdParty/Windows/WinPixEventRuntime/', r'winpixeventruntime|\bpix event'),
    (r'^Engine/Binaries/ThirdParty/Windows/XAudio2_9/', 'VENDOR'),
    (r'(^|/)EOSSDK-Win64-Shipping\.dll$', 'VENDOR'),
    (r'(^|/)(msvcp140|vcruntime140|vccorlib140|concrt140)[^/]*\.dll$', 'VENDOR'),
    (r'(^|/)vc_redist\.x64\.exe$', 'VENDOR'),
    (r'(^|/)Fonts/LastResort\.ttf$', r'\blast ?resort\b'),
    (r'/Onnxruntime/.*onnxruntime\.dll$', r'\bonnxruntime\b|\bonnx runtime\b'),
    (r'(^|/)D3D12/x64/(D3D12Core|d3d12SDKLayers)\.dll$', r'\bagility ?sdk\b'),
    (r'(^|/)DML/x64/DirectML\.dll$', r'\bdirectml\b'),
    (r'(^|/)(tbb12|tbbmalloc)\.dll$', r'\bonetbb\b|[\\/]tbb[\\/]'),
]
VENDOR_TERMS = [   # named truthfully; no URL or text is invented for them
    ('Microsoft XAudio2 redistributable (xaudio2_9redist.dll)', r'(^|/)xaudio2_9redist\.dll$'),
    ('Epic Online Services SDK (EOSSDK-Win64-Shipping.dll), Epic Games, Inc.', r'(^|/)EOSSDK-Win64-Shipping\.dll$'),
    ('Microsoft Visual C++ runtime (msvcp140 / vcruntime140 / vccorlib140 / concrt140 DLLs and vc_redist.x64.exe)',
     r'(^|/)(msvcp140|vcruntime140|vccorlib140|concrt140)[^/]*\.dll$|(^|/)vc_redist\.x64\.exe$'),
]


def read_tps(path):
    """A .tps as text, whatever its form: UTF-16 or UTF-8 XML, or Epic's NNE form (a 'TPS' line, then the XML in quotes)."""
    data = open(path, 'rb').read()
    if data[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return data.decode('utf-16', 'replace')
    return data.decode('utf-8-sig', 'replace')


def tps_field(text, name):
    m = re.search(rf'<{name}>(.*?)</{name}>', text, re.S)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else ''


def resolve_license(engine, lic, tps_path=''):
    """A <LicenseFolder> value -> an existing license FILE, or None. When it names only the generic Licenses FOLDER (the NNE records),
    the license file is the one whose stem is the .tps's own stem (Onnxruntime_v1.24.1.tps -> Licenses/Onnxruntime_v1.24.1.license)."""
    if not lic:
        return None
    licdir = os.path.join(engine, 'Engine', 'Source', 'ThirdParty', 'Licenses')
    rel = lic.replace('/', os.sep).strip(os.sep)
    for cand in (os.path.join(engine, rel), os.path.join(licdir, os.path.basename(rel))):
        if os.path.isfile(cand):
            return cand
    folder = os.path.join(engine, rel)
    if tps_path and os.path.isdir(folder):
        stem = os.path.splitext(os.path.basename(tps_path))[0].lower()
        for n in sorted(os.listdir(folder)):
            if os.path.splitext(n)[0].lower() == stem and os.path.isfile(os.path.join(folder, n)):
                return os.path.join(folder, n)
    return None


def tps_row(engine, p, source):
    row = {'tps': os.path.relpath(p, engine) if p.lower().startswith(engine.lower()) else p, 'source': source}
    try:
        text = read_tps(p)
        sw = re.search(r'Software Name:\s*([^\r\n]+)', text)
        ver = re.search(r'Version:\s*([^\r\n]+)', text)
        clean = lambda v: re.sub(r'\s*-->\s*$', '', v.strip())   # a comment's closing marker is not part of a version
        name = (clean(sw.group(1)) + (' ' + clean(ver.group(1)) if ver else '')) if sw else tps_field(text, 'Name')
        row.update(name=name, location=tps_field(text, 'Location'), eula=tps_field(text, 'Eula'),
                   license_folder=tps_field(text, 'LicenseFolder'))
    except OSError as e:   # a listed .tps that is missing on disk is kept and named, never silently dropped
        row.update(name='', location='', eula='', license_folder='', parse_error=str(e)[:120])
    lf = resolve_license(engine, row.get('license_folder', ''), p)
    row['license_file'] = os.path.relpath(lf, engine) if lf else None
    row['status'] = 'TEXT' if lf else ('URL' if row.get('eula', '').startswith('http') else 'UNRESOLVED')
    return row


def shipped_check(files, rows):
    """(lines, gaps): every redistributed binary / font (by extension), except OWN, must match a SHIPPED_MAP pattern whose component
    is in rows (or VENDOR). gaps = the unmapped files plus the mapped-but-unlisted ones."""
    hay = [((r.get('name') or '') + ' | ' + (r.get('location') or '') + ' | ' + r['tps']).lower() for r in rows]
    lines, gaps = [], []
    redist = sorted(f for f in files if f.lower().endswith(REDIST_EXT) and f not in OWN)
    for f in redist:
        pats = [(pat, comp) for pat, comp in SHIPPED_MAP if re.search(pat, f, re.I)]
        if not pats:
            lines.append(f'  GAP  {f} -> NO mapping (a redistributed binary / font this tool does not know)')
            gaps.append(f)
            continue
        pat, comp = pats[0]
        if comp == 'VENDOR':
            lines.append(f'  ok   {f} -> VENDOR TERMS (no engine record; named in the notices)')
            continue
        comps = sorted({rows[i].get('name') or rows[i]['tps'] for i, h in enumerate(hay) if re.search(comp, h, re.I)})
        lines.append(f'  {"ok  " if comps else "GAP "} {f} -> {comps[:3] if comps else "its component is in NO listed record"}')
        if not comps:
            gaps.append(f)
    return lines, gaps


def write_notices(path, engine, rows, files):
    by_text = {}
    for r in rows:
        key = r['license_file'] or (r['eula'] if r['status'] == 'URL' else None)
        if key:
            by_text.setdefault(key, []).append(r)
    with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
        f.write('WONDERLAND PRIVATE BETA -- THIRD-PARTY SOFTWARE NOTICES\n\n')
        f.write('This package includes third-party software. Each component below remains under its own license; nothing in\n')
        f.write("Wonderland's own terms changes those licenses. The list comes from the Unreal Engine's own third-party records for\n")
        f.write("this game target (Epic's ListThirdPartySoftware) and errs on the side of listing more. Epic's own notice is in\n")
        f.write('NOTICES.txt beside this file.\n\n')
        for key in sorted(by_text, key=lambda k: ((by_text[k][0].get('name') or k).lower(), k)):
            comps = by_text[key]
            names = sorted({c.get('name') or os.path.basename(c['tps']) for c in comps})
            f.write('=' * 100 + '\n')
            f.write('Component(s): ' + '; '.join(names) + '\n')
            if key.startswith('http'):
                f.write(f'License: {key}\n\n')
            else:
                data = open(os.path.join(engine, key), 'rb').read()
                enc = 'utf-16' if data[:2] in (b'\xff\xfe', b'\xfe\xff') else 'utf-8-sig'
                f.write('License text:\n\n' + data.decode(enc, 'replace').replace('\r\n', '\n').strip() + '\n\n')
        nolic = sorted({(r.get('name') or os.path.basename(r['tps'])) + '  [' + r['tps'] + ']' for r in rows if r['status'] == 'UNRESOLVED'})
        if nolic:
            f.write('=' * 100 + '\n')
            f.write("Components listed in the engine's third-party records WITHOUT a bundled license text or URL (named for\n")
            f.write('completeness; each bracket is the engine record):\n\n' + '\n'.join('  - ' + x for x in nolic) + '\n\n')
        vt = [name for name, pat in VENDOR_TERMS if any(re.search(pat, x, re.I) for x in files)]
        if vt:
            f.write('=' * 100 + '\n')
            f.write("Redistributed under their vendors' own terms (the engine holds no third-party record for them):\n\n")
            f.write('\n'.join('  - ' + x for x in vt) + '\n')
    return len(by_text)


def selftest():
    """The completeness rule's own controls: a known file set maps clean; a planted unmapped DLL and a mapped-but-unlisted one GAP."""
    rows = [{'tps': 'Engine\\Source\\ThirdParty\\MsQuic\\MsQuic.tps', 'name': 'MsQuic', 'location': '', 'status': 'TEXT'},
            {'tps': 'Engine\\Binaries\\ThirdParty\\Ogg\\OggVorbis.tps', 'name': 'Ogg Vorbis Audio Compression', 'location': '', 'status': 'TEXT'}]
    base = ['Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe', 'Engine/Binaries/ThirdParty/MsQuic/v220/win64/msquic.dll',
            'Engine/Binaries/ThirdParty/Ogg/Win64/VS2015/libogg_64.dll', 'Engine/Binaries/Win64/EOSSDK-Win64-Shipping.dll',
            'Wonderland/Binaries/Win64/vcruntime140.dll', 'README_BETA.txt', 'Wonderland/Content/Paks/Wonderland-Windows.pak']
    cases = [
        ('C1 the known set maps clean', shipped_check(base, rows)[1], []),
        ('C2 a planted UNMAPPED dll is a GAP', shipped_check(base + ['Engine/Binaries/ThirdParty/Planted/planted.dll'], rows)[1],
         ['Engine/Binaries/ThirdParty/Planted/planted.dll']),
        ('C3 a planted loose font is a GAP', shipped_check(base + ['Wonderland/Content/Fonts/Planted.otf'], rows)[1],
         ['Wonderland/Content/Fonts/Planted.otf']),
        ('C4 a mapped file whose record is NOT listed is a GAP', shipped_check(base + ['Wonderland/Binaries/Win64/tbb12.dll'], rows)[1],
         ['Wonderland/Binaries/Win64/tbb12.dll']),
        ('C5 the game exe and the bootstrap are not GAPs', shipped_check(['Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe'], rows)[1], []),
        ('C6 a .pak / .txt is not a redistributed binary', shipped_check(['Wonderland/Content/Paks/x.pak', 'NOTICES.txt'], rows)[1], []),
        ('C7 a loose "pix" word does not map WinPixEventRuntime (draft 1 bug)',
         shipped_check(['Engine/Binaries/ThirdParty/Windows/WinPixEventRuntime/x64/WinPixEventRuntime.dll'],
                       [{'tps': 'Engine\\Shaders\\Private\\SMAA\\Subpixel.tps', 'name': 'Subpixel Morphological AA', 'location': '', 'status': 'URL'}])[1],
         ['Engine/Binaries/ThirdParty/Windows/WinPixEventRuntime/x64/WinPixEventRuntime.dll']),
    ]
    bad = [n for n, got, want in cases if got != want]
    for n, got, want in cases:
        print(f'{"ok  " if got == want else "BAD "} {n}: {got}')
    print(f'SELFTEST {"PASS" if not bad else "FAIL"} ({len(cases) - len(bad)} of {len(cases)})')
    return not bad


def main():
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    ap = argparse.ArgumentParser()
    ap.add_argument('--tps-log', required=True)
    ap.add_argument('--engine', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--shipped', required=True)
    A = ap.parse_args()
    assert not os.path.exists(A.out), f'{A.out} exists (never overwritten)'
    engine = os.path.normpath(A.engine)
    tps_paths = []
    for line in open(A.tps_log, encoding='utf-8', errors='replace'):
        m = re.search(r'([A-Za-z]:\\[^()\r\n]*?\.tps)', line)
        if m:
            tps_paths.append(os.path.normpath(m.group(1).strip()))
    tps_paths = sorted(set(tps_paths))
    assert tps_paths, f'no .tps record in {A.tps_log}: refusing to write notices from nothing'
    rows = [tps_row(engine, p, 'UAT ListThirdPartySoftware') for p in tps_paths]
    listed = {os.path.normcase(p) for p in tps_paths}
    files = []
    for dp, _, ns in os.walk(A.shipped):
        for n in ns:
            files.append(os.path.relpath(os.path.join(dp, n), A.shipped).replace(os.sep, '/'))
    beside = []
    for rel in sorted({os.path.dirname(f) for f in files if f.lower().startswith('engine/')}):
        for cand_dir in (os.path.join(engine, rel), os.path.dirname(os.path.join(engine, rel))):
            if os.path.isdir(cand_dir):
                for n in sorted(os.listdir(cand_dir)):
                    q = os.path.normpath(os.path.join(cand_dir, n))
                    if n.lower().endswith('.tps') and os.path.normcase(q) not in listed:
                        listed.add(os.path.normcase(q))
                        beside.append(q)
    rows += [tps_row(engine, p, 'beside a shipped binary') for p in beside]
    os.makedirs(A.out)
    sections = write_notices(os.path.join(A.out, 'THIRD_PARTY_NOTICES.txt'), engine, rows, files)
    json.dump(rows, open(os.path.join(A.out, 'notices_map.json'), 'w', encoding='utf-8'), indent=1)
    lines = [f'{len(rows)} .tps records ({len(tps_paths)} from {os.path.basename(A.tps_log)} + {len(beside)} beside the shipped binaries); '
             f'{sections} distinct license texts / URLs; UNRESOLVED (named, no text or URL) {sum(1 for r in rows if r["status"] == "UNRESOLVED")}']
    chk, gaps = shipped_check(files, rows)
    lines.append(f'REDISTRIBUTED binaries / fonts in {os.path.basename(os.path.normpath(A.shipped))} (of {len(files)} files), each mapped:')
    lines += chk
    lines.append(f'GAPS: {len(gaps)}')
    open(os.path.join(A.out, 'SUMMARY.txt'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    sys.exit(1 if gaps else 0)


if __name__ == '__main__':
    main()
