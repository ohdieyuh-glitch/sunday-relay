"""make_package_notices.py -- the Wonderland package's THIRD-PARTY NOTICES, built from the Unreal Engine's OWN third-party records
(CORE, 2026-10-07; the founder's ruling 10:57Z: "Preserve third-party software/license obligations independently of the project-level
proprietary license"; the Unreal Engine EULA's Third Party Software clause: "those terms or other attribution requirements can be
found in the installation directory for each engine version under the /Engine/Source/ThirdParty/Licenses sub-folder").

  python -I make_package_notices.py --tps-log <log> --engine <UE root> --out <NEW folder> --shipped <package folder>
                                    [--ufs-manifest <the staged build's Manifest_UFSFiles_Win64.txt>]
  python -I make_package_notices.py --selftest

v2.2 (2026-10-07; two rounds of CORE's internal review: reviewers 1-3, then reviewer 6):
- PARSING: every line of UAT's ListThirdPartySoftware output that names a .tps or a "(redirect from ...)" parses, or the run is an
  ERROR (exit 2). A redirect to a FOLDER brings every record in it; to a non-.tps FILE, the file is the stub's license candidate; to
  anything else, the stub stays a named row. Nothing is dropped silently. A listed record missing on disk stays a row (named by its
  file), resolved by that name.
- A LICENSE TEXT MUST HAVE A BODY: a candidate counts only if, after Epic's "Software Name / Version / URL" header, a real body is
  left (>= 200 characters naming license / copyright / permission / warranty / redistribution terms). A header-only or pointer-only
  file is not a text: the record falls back to its URL (the header's or <Eula>), else UNRESOLVED.
- THE SEARCH (logged for EVERY row): <LicenseFolder> in each form Epic writes it (a file; a depot path; a glob; a folder; a bare
  hint); the Licenses folder AND its subfolders, by the record's names (versions, commit ids, "(guid)", "lib" ignored; a separated
  version only); the record's OWN folder and its <Location> folder (LICENSE / COPYING / COPYRIGHT / NOTICE files); and a short,
  REVIEWED list of records whose terms live in a source header (SOURCE_TERMS). A .tps is never a license.
- SHIPPED FILES are mapped by their EXACT names (an unknown DLL in a known folder is a GAP), each to a component keyed by its RECORD
  path; a VENDOR file needs its VENDOR_TERMS entry. Loose AND packed (the UFS manifest): binaries, fonts (.ufont too), the CA bundle.
- REQUIRED ATTRIBUTIONS (verbatim, at the top): the IJG statement (libjpeg-turbo) and the FreeType Team disclaimer (FreeType's FTL).
- Every section prints its Record(s), so a reader can check the mapping against the records themselves.
Exit: 0 written, every redistributed file mapped; 1 a GAP (written, for inspection); 2 an ERROR (nothing trustworthy written).
Writes ONLY into --out (refused if it exists): THIRD_PARTY_NOTICES.txt (UTF-8, CRLF), notices_map.json, SUMMARY.txt.
"""
import argparse
import fnmatch
import json
import os
import re
import sys

REDIST_EXT = ('.dll', '.exe', '.ttf', '.otf', '.ttc', '.woff', '.woff2', '.ufont', '.pem')
# the game itself (its linked libraries are the module records UAT lists) and Epic's generic bootstrap (Epic's own Licensed Technology)
OWN = ('Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe')
VC = r'(msvcp140|msvcp140_1|msvcp140_2|msvcp140_atomic_wait|msvcp140_codecvt_ids|vcruntime140|vcruntime140_1|vcruntime140_threads|vccorlib140|concrt140)'
# v2.3 (R3): (an EXACT shipped-path pattern anchored at the package root, the EXACT engine-relative record path, the need:
# 'TEXT' + the license FAMILY's fingerprint, 'URL' + the pinned URL, or 'VENDOR')
SHIPPED_MAP = [
    (r'^Engine/Binaries/ThirdParty/DbgHelp/dbghelp\.dll$', r'Engine\Binaries\ThirdParty\DbgHelp\dbghelp.tps',
     'URL', 'https://docs.microsoft.com/en-us/legal/windows-sdk/license-terms-ewdk'),
    (r'^Engine/Binaries/ThirdParty/MsQuic/v220/win64/msquic\.dll$', r'Engine\Source\ThirdParty\MsQuic\MsQuic.tps', 'TEXT', r'MIT License.*Permission is hereby granted'),
    (r'^Engine/Binaries/ThirdParty/NVIDIA/NVaftermath/Win64/GFSDK_Aftermath_Lib\.x64\.dll$',
     r'Engine\Source\ThirdParty\NVIDIA\NVaftermath\NVIDIA Aftermath SDK_v2025.5.0.251114 (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps',
     'TEXT', r'NVIDIA.*Software License Agreement'),
    (r'^Engine/Binaries/ThirdParty/Ogg/Win64/VS2015/libogg_64\.dll$', r'Engine\Source\ThirdParty\Ogg\OggVorbis.tps', 'TEXT', r'Xiph\.org.*binary forms?'),
    (r'^Engine/Binaries/ThirdParty/Vorbis/Win64/VS2015/libvorbis(file)?_64\.dll$', r'Engine\Source\ThirdParty\Ogg\OggVorbis.tps', 'TEXT', r'Xiph\.org.*binary forms?'),
    (r'^Engine/Binaries/ThirdParty/Windows/WinPixEventRuntime/x64/WinPixEventRuntime\.dll$',
     r'Engine\Binaries\ThirdParty\Windows\WinPixEventRuntime\WinPixEventRuntime.tps', 'URL', 'https://www.microsoft.com/web/webpi/eula/eula_pix_event_runtime.htm'),
    (r'^Engine/Binaries/ThirdParty/Windows/XAudio2_9/x64/xaudio2_9redist\.dll$', 'VENDOR', 'VENDOR', ''),
    (r'^Engine/Binaries/Win64/EOSSDK-Win64-Shipping\.dll$', 'VENDOR', 'VENDOR', ''),
    (r'^(Engine|Wonderland)/Binaries/Win64/' + VC + r'\.dll$', 'VENDOR', 'VENDOR', ''),
    (r'^Engine/Extras/Redist/en-us/vc_redist\.x64\.exe$', 'VENDOR', 'VENDOR', ''),
    (r'^Wonderland/Binaries/Win64/D3D12/x64/(D3D12Core|d3d12SDKLayers)\.dll$', r'Engine\Source\ThirdParty\Windows\AgilitySDK\1.618.5\AgilitySDK.tps',
     'TEXT', r'MICROSOFT SOFTWARE LICENSE TERMS'),
    (r'^Wonderland/Binaries/Win64/(tbb12|tbbmalloc)\.dll$', r'Engine\Source\ThirdParty\Intel\TBB\oneTBB.tps', 'TEXT', r'Apache License,? Version 2\.0'),
    # fonts, the CA bundle and the ICU data, loose or inside the pak (the UFS manifest)
    (r'^Engine/Content/SlateDebug/Fonts/LastResort\.(ttf|ufont)$', r'Engine\Content\SlateDebug\Fonts\LastResort.tps', 'TEXT', r'FONT SOFTWARE LICENSE AGREEMENT'),
    (r'^Engine/Content/(Slate/Fonts|Slate/Old/Tiles|EngineFonts/Faces)/Roboto[^/]*\.(ttf|ufont)$', r'Engine\Content\Slate\Fonts\Roboto.tps', 'TEXT', r'Apache License'),
    (r'^Engine/Content/Slate/Fonts/Noto[^/]*\.(ttf|otf)$', r'Engine\Content\Slate\Fonts\Noto.tps', 'TEXT', r'SIL Open Font License,? Version 1\.1'),
    (r'^Engine/Content/(Slate/Fonts|EngineFonts/Faces)/DroidSans[^/]*\.(ttf|ufont)$', r'Engine\Build\Android\Java\AndroidOpenSourceProject.tps',
     'TEXT', r'Apache License,? Version 2\.0'),
    (r'^Engine/Content/Certificates/ThirdParty/cacert\.pem$', r'Engine\Content\Certificates\ThirdParty\cacert.pem.tps', 'TEXT', r'Mozilla Public License,? Version 2\.0'),
    (r'^Engine/Content/Internationalization/icudt64l/.+$', r'Engine\Source\ThirdParty\ICU\ICU_64-1.tps', 'TEXT', r'COPYRIGHT AND PERMISSION NOTICE.*Unicode data files'),
]
# B1 (R3): DEFAULT-DENY. OWN = the package's / Epic's own content: the game, its bootstrap and the package's own documents, and these
# types anywhere EXCEPT under a ThirdParty folder (a .tps record file excepted). Everything else must be MAPPED above, or it is a GAP.
OWN_FILES = ('Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe', 'README_BETA.txt', 'THIRD_PARTY_NOTICES.txt', 'WONDERLAND_BETA_EULA.txt')
OWN_EXT = ('.uasset', '.ubulk', '.uexp', '.umap', '.uplugin', '.upluginmanifest', '.uproject', '.ini', '.png', '.svg', '.cur', '.bin',
           '.tps', '.locmeta', '.locres', '.ushaderbytecode', '.stinfo', '.pak', '.ucas', '.utoc', '.json', '.wlvox', '.txt')


def classify(path):
    """-> ('OWN', None) | ('MAP', row) | ('UNCLASSIFIED', None): one shipped path ('/' separators, from the package root)."""
    for row in SHIPPED_MAP:
        if re.search(row[0], path, re.I):
            return 'MAP', row
    if path in OWN_FILES:
        return 'OWN', None
    low = path.lower()
    ext = os.path.splitext(low)[1]
    if '/thirdparty/' in low and ext != '.tps':
        return 'UNCLASSIFIED', None
    return ('OWN', None) if ext in OWN_EXT else ('UNCLASSIFIED', None)


VENDOR_TERMS = [   # named truthfully; no URL or text is invented for them
    ('Microsoft XAudio2 redistributable (xaudio2_9redist.dll)', r'(^|/)xaudio2_9redist\.dll$'),
    ('Epic Online Services SDK (EOSSDK-Win64-Shipping.dll), Epic Games, Inc.', r'(^|/)EOSSDK-Win64-Shipping\.dll$'),
    ('Microsoft Visual C++ runtime (msvcp140 / vcruntime140 / vccorlib140 / concrt140 DLLs and vc_redist.x64.exe)',
     r'(^|/)' + VC + r'\.dll$|(^|/)vc_redist\.x64\.exe$'),
]
# statements a license REQUIRES in the product's documentation: (a regex on the component's record path or name, the statement)
REQUIRED_ATTRIBUTIONS = [
    (r'libjpeg-turbo', 'This software is based in part on the work of the Independent JPEG Group.'),
    (r'freetype', 'This software is based in part on the work of the FreeType Team (https://freetype.org).'),
]
# records whose terms live in a SOURCE file (reviewed 2026-10-07, reviewer 6): record path regex -> (source file relative to the
# record's folder, 'leading' = the first /* */ block, or 'from:<marker>' = from the comment that holds <marker> to its end)
SOURCE_TERMS = [
    (r'pfft[\\/]pffft\.tps$', ('pffft.h', 'leading')),
    (r'stb_image_resize[\\/]stb_image_resize2\.h\.tps$', ('stb_image_resize2.h', 'from:This software is available under 2 licenses')),
    (r'intel[\\/]extensionsframework[\\/]intelextensionsframework\.tps$', ('igdext.h', 'leading')),
]
# records whose license FILE the name rules cannot find (reviewed 2026-10-07, reviewer 6): record path regex -> Licenses/ file names
EXPLICIT_LICENSES = [
    (r'mobilephonebezelfmorrison\.tps$', ['MobilePhoneBezelImages-Fmorrison_License.txt']),
    (r'mobilephonebezelrayukk\.tps$', ['MobilePhoneBezelImages-Rayukk_License - Copy.txt']),
    (r'distributed-shaders-compilation-fastbuild\.tps$', ['UnrealFASTBuild_v0-95_License.txt']),
    (r'basegizmos[\\/]geometry-tools-engine\.tps$', ['GTEngine_License.txt']),
    # R3 (2026-10-07): the Aftermath record's own .license is a header-only pointer; Epic's Licenses folder holds the NVIDIA SDK
    # license for Aftermath (and NVAPI) under this name
    (r'nvaftermath[\\/]nvidia aftermath sdk_[^\\/]*\.tps$', ['Aftermath_NVAPI_License.txt']),
]
LINE = re.compile(r'^(?P<path>[A-Za-z]:\\.+?)(?:\s+\(redirect from (?P<frm>[A-Za-z]:\\.+?\.tps)\))?\s*$', re.I)
GUID = re.compile(r'\s*\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)\s*$', re.I)
DRIVE_PATH = re.compile(r'(?<![A-Za-z])[A-Za-z]:[\\/]')
LICENSE_FILE = re.compile(r'^(license|licence|copying|copyright|notice)(\.[a-z0-9]+)?$', re.I)
TERMS = re.compile(r'licen[cs]e|copyright|permission|warrant|redistribut', re.I)


class Fail(Exception):
    """An ERROR: the notices cannot be trusted (exit 2)."""


def decode(data):
    """Strict: UTF-16 by BOM, else UTF-8 (BOM allowed), else Windows-1252. Never 'replace'."""
    if data[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return data.decode('utf-16')
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('cp1252')


def read_text(path):
    with open(path, 'rb') as f:
        return decode(f.read())


def tps_field(text, name):
    m = re.search(rf'<{name}>(.*?)</{name}>', text, re.S)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.group(1))).strip() if m else ''


def body_of(text):
    """A license file's BODY: Epic's 'Software Name / Version / URL' header and its '=====' rules removed."""
    t = re.sub(r'(?im)^\s*"?(software name|version|url|download url|license)\s*:.*$', '', text)
    t = re.sub(r'(?im)^\s*"?license"?\s*$', '', t)
    t = re.sub(r'(?m)^\s*"?=+\s*"?\s*$', '', t)
    return t.strip().strip('"').strip()


def header_url(text):
    m = re.search(r'(?im)^\s*"?(?:download )?url\s*:\s*(https?://\S+)', text)
    return m.group(1) if m else ''


def body_ok(text):
    b = body_of(text)
    return len(b) >= 200 and bool(TERMS.search(b))


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def name_keys(*names):
    """Normalized lookup keys: each name as written, without a SEPARATED trailing version / commit id / guid, and without a leading
    "lib" (libOpus -> opus); each >= 3 characters. 'Caffe2' keeps its 2 (no separator)."""
    keys = set()
    for n in names:
        if not n or n.strip().lower() in ('none', 'todo', 'n/a'):
            continue
        n = GUID.sub('', re.sub(r'<[^>]+>', '', n))
        n = re.sub(r'\.(txt|license|licence|md|tps)$', '', n, flags=re.I)
        n = GUID.sub('', n)
        n = re.sub(r'[\s_.\-]*(license|licence|copying)$', '', n, flags=re.I)
        bare = re.sub(r'(?:[\s_\-]+(?:v|ver|version)?[\s_.]*|(?<=[a-z])(?:v|ver|version)[\s_.]*)\d[\w.\-]*$', '', n, flags=re.I)
        bare = re.sub(r'[\s_\-]+v?(?=[0-9a-f]*\d)[0-9a-f]{6,40}$', '', bare, flags=re.I)
        for v in (n, bare):
            k = norm(v)
            if len(k) >= 3:
                keys.add(k)
            if k.startswith('lib') and len(k) >= 7:
                keys.add(k[3:])
    return keys


class LicenseIndex:
    """Engine/Source/ThirdParty/Licenses AND its subfolders, keyed by each file's normalized stem (license / version suffix off)."""

    def __init__(self, engine):
        self.dir = os.path.join(engine, 'Engine', 'Source', 'ThirdParty', 'Licenses')
        self.files = []
        for r_, ds, ns in os.walk(self.dir):
            ds.sort()
            for n in sorted(ns):
                if not n.lower().endswith('.tps'):
                    self.files.append(os.path.join(r_, n))
        self.by_key = {}
        for f in self.files:
            for k in name_keys(os.path.basename(f)):
                self.by_key.setdefault(k, set()).add(f)

    def lookup(self, keys):
        """Exact key matches; else a record key that STARTS WITH an index key of >= 5 characters, with <= 8 characters left."""
        hits = set()
        for k in keys:
            hits |= self.by_key.get(k, set())
        if not hits:
            for k in keys:
                for ik, names in self.by_key.items():
                    if len(ik) >= 5 and k.startswith(ik) and 0 < len(k) - len(ik) <= 8:
                        hits |= names
        return sorted(hits)


def engine_rel(value):
    """A path in any of Epic's forms (/Engine/.., //UE5/Main/Engine/.., \\UE4\\Engine\\..) -> an engine-relative path, or ''."""
    v = value.strip().strip('"').replace('\\', '/')
    m = re.search(r'(^|/)(Engine/.*)$', v, re.I)
    return m.group(2).rstrip('/') if m else ''


def source_terms(engine_tps_path, mode):
    """The license comment of a reviewed source file (SOURCE_TERMS), as text."""
    fname, how = mode
    p = os.path.join(os.path.dirname(engine_tps_path), fname)
    if not os.path.isfile(p):
        return ''
    t = read_text(p)
    if how == 'leading':
        m = re.match(r'\s*/\*(.*?)\*/', t, re.S)
        return ('/*' + m.group(1) + '*/') if m else ''
    if how.startswith('from:'):
        i = t.find(how[5:])
        if i < 0:
            return ''
        start = t.rfind('/*', 0, i)
        end = t.find('*/', i)
        return t[start if start >= 0 else i:(end + 2) if end >= 0 else len(t)]
    return ''


def resolve_license(engine, index, row, tps_path):
    """-> (license files, how, log, inline source terms). Every candidate must have a real BODY (body_ok); a .tps never counts."""
    lic = row.get('license_folder', '')
    names = [row.get('name', '')]
    rel = engine_rel(lic) if lic else ''
    log = {'license_folder': lic, 'engine_rel': rel, 'keys': [], 'folders': [], 'rejected_no_body': []}
    cands, how = [], ''

    def good(paths, label):
        nonlocal cands, how
        ok = []
        for p in paths:
            if p.lower().endswith('.tps') or not os.path.isfile(p):
                continue
            try:
                txt = read_text(p)
            except OSError:
                continue
            if body_ok(txt):
                ok.append(p)
            else:
                log['rejected_no_body'].append(os.path.relpath(p, engine))
        if ok and not cands:
            cands, how = ok, label
        return ok

    for pat, names_ in EXPLICIT_LICENSES:   # a reviewed pairing comes first (still body-checked)
        if re.search(pat, tps_path.replace('/', '\\'), re.I):
            good([os.path.join(index.dir, n) for n in names_], 'explicit')
    if rel and not cands:
        full = os.path.join(engine, rel.replace('/', os.sep))
        if '*' in rel:
            folder, pat = os.path.split(full)
            if os.path.isdir(folder):
                good([os.path.join(folder, n) for n in sorted(os.listdir(folder)) if fnmatch.fnmatch(n.lower(), pat.lower())], 'glob')
        elif os.path.isfile(full):
            good([full], 'file')
        elif os.path.isdir(full):
            log['folders'].append(rel)
            good([os.path.join(full, n) for n in sorted(os.listdir(full)) if LICENSE_FILE.match(n)], 'folder')
        if not cands:
            k1 = name_keys(os.path.basename(rel))
            log['keys'] += sorted(k1)
            good(index.lookup(k1), 'named-file-by-name')
    if not cands:
        hint = lic if (lic and not rel) else ''
        k2 = name_keys(os.path.basename(tps_path), hint, *names)
        log['keys'] += sorted(k2)
        good(index.lookup(k2), 'by-name')
    if not cands:   # the record's own folder, and its <Location>
        own = os.path.dirname(tps_path)
        locs = [own]
        lrel = engine_rel(row.get('location', ''))
        if lrel:
            locs.append(os.path.join(engine, lrel.replace('/', os.sep)))
        for d in locs:
            if os.path.isdir(d):
                log['folders'].append(os.path.relpath(d, engine))
                good([os.path.join(d, n) for n in sorted(os.listdir(d)) if LICENSE_FILE.match(n)], 'record-folder')
    inline = ''
    if not cands:
        for pat, mode in SOURCE_TERMS:
            if re.search(pat, tps_path.replace('/', '\\'), re.I):
                inline = source_terms(tps_path, mode)
                how = 'source-header' if inline else ''
                log['source_terms'] = mode[0]
    log['keys'] = sorted(set(log['keys']))
    log['index_files'] = len(index.files)
    return cands, how, log, inline


def follow_redirect(path, hops=3):
    """A .tps "Redirect:" stub -> the record files it points at (a file, or every .tps in a folder)."""
    for _ in range(hops):
        try:
            text = read_text(path)
        except OSError:
            return []
        m = re.search(r'Redirect:\s*([^\s<]+)', text)
        if not m or tps_field(text, 'Name'):
            return [path]
        target = os.path.normpath(os.path.join(os.path.dirname(path), m.group(1).replace('/', os.sep)))
        if os.path.isfile(target):
            path = target
            continue
        folder = target if os.path.isdir(target) else os.path.dirname(target)
        if os.path.isdir(folder):
            return [os.path.join(folder, n) for n in sorted(os.listdir(folder)) if n.lower().endswith('.tps')]
        return []
    return [path]


def tps_row(engine, index, p, source):
    rel = os.path.relpath(p, engine) if os.path.normcase(p).startswith(os.path.normcase(engine)) else os.path.basename(p) + ' (outside the engine)'
    row = {'tps': rel, 'source': source}
    try:
        text = read_text(p)
        sw = re.search(r'Software Name:\s*([^\r\n]+)', text)
        ver = re.search(r'Version:\s*([^\r\n]+)', text)
        clean = lambda v: re.sub(r'\s*-->\s*$', '', re.sub(r'<[^>]+>', '', v).strip())
        name = (clean(sw.group(1)) + (' ' + clean(ver.group(1)) if ver else '')) if sw else tps_field(text, 'Name')
        row.update(name=name, location=tps_field(text, 'Location'), eula=tps_field(text, 'Eula'),
                   license_folder=tps_field(text, 'LicenseFolder'))
    except OSError as e:   # a listed record missing on disk stays a row, named by its file, resolved by that name
        row.update(name=os.path.splitext(os.path.basename(p))[0], location='', eula='', license_folder='', record_missing=type(e).__name__)
    files, how, log, inline = resolve_license(engine, index, row, p)
    row['license_files'] = [os.path.relpath(f, engine) for f in files]
    row['resolved_by'] = how
    if inline:
        row['source_terms'] = inline
    url = row.get('eula', '') if row.get('eula', '').lower().startswith('http') else ''
    if not url:   # a header-only license file may still carry the component's URL
        for r_ in log['rejected_no_body']:
            u = header_url(read_text(os.path.join(engine, r_)))
            if u:
                url = u
                break
    row['url'] = url
    row['status'] = 'TEXT' if (files or inline) else ('URL' if url else 'UNRESOLVED')
    row['search'] = log
    return row


def parse_tps_log(path):
    """-> (record paths, redirect-from stubs, folder targets, stub->file targets, junk-target stubs). Every relevant line parses."""
    records, stubs, folders, filetargets, junk, bad = [], [], [], [], [], []
    with open(path, 'rb') as f:
        text = decode(f.read())
    for raw in text.splitlines():
        line = raw.strip()
        if '.tps' not in line.lower() and 'redirect from' not in line.lower():
            continue
        m = LINE.match(line)
        if not m:
            bad.append(line)
            continue
        target, frm = m.group('path').strip(), m.group('frm')
        if frm:
            stubs.append(os.path.normpath(frm))
        if target.lower().endswith('.tps'):
            records.append(os.path.normpath(target))
        elif frm and os.path.isdir(target):
            folders.append(os.path.normpath(target))
        elif frm and os.path.isfile(target):
            filetargets.append((os.path.normpath(frm), os.path.normpath(target)))
        elif frm:
            junk.append(os.path.normpath(frm))   # a redirect to nothing usable ("<\Notification>"): the stub stays a named row
        else:
            bad.append(line)
    if bad:
        raise Fail('unparsed ListThirdPartySoftware line(s): ' + ' || '.join(b[:160] for b in bad))
    uniq = lambda xs: sorted({os.path.normcase(x): x for x in xs}.values(), key=str.lower)
    return uniq(records), uniq(stubs), uniq(folders), sorted(set(filetargets)), uniq(junk)


def row_text(engine, r):
    """A record row's license TEXT, flattened: its license files' bodies (Epic's header lines removed) + its source-header terms."""
    if 'license_text' in r:   # the selftest's planted rows
        parts = [r['license_text']]
    else:
        parts = [body_of(read_text(os.path.join(engine, lf))) for lf in r.get('license_files', [])] + [r.get('source_terms', '')]
    return ' '.join(' '.join(parts).split())


def shipped_check(files, rows, engine=''):
    """(lines, gaps), v2.3 (R3): EVERY shipped file, loose and packed, is classified (DEFAULT-DENY). A MAPPED file needs a listed record
    at its EXACT path whose license text matches the row's FAMILY fingerprint (TEXT), or which carries the PINNED URL (URL), or its
    VENDOR_TERMS name; an UNCLASSIFIED file is a GAP."""
    by_path = {}
    for r in rows:
        by_path.setdefault((r['tps'] or '').lower(), []).append(r)
    memo = {}
    lines, gaps = [], []
    for f in sorted(files):
        path = f.split('pak:', 1)[-1]
        cls, row = classify(path)
        if cls == 'OWN':
            continue
        if cls == 'UNCLASSIFIED':
            lines.append(f'  GAP  {f} -> UNCLASSIFIED: not the package\'s / Epic\'s own content, and no mapping (a redistributed file this tool does not know)')
            gaps.append(f)
            continue
        rec, need, check = row[1], row[2], row[3]
        if need == 'VENDOR':
            vt = [name for name, vp in VENDOR_TERMS if re.search(vp, path, re.I)]
            if vt:
                lines.append(f'  ok   {f} -> VENDOR TERMS: {vt[0]}')
            else:
                lines.append(f'  GAP  {f} -> VENDOR, but no VENDOR_TERMS entry names it')
                gaps.append(f)
            continue
        if rec not in memo:
            hits = by_path.get(rec.lower(), [])
            if not hits:
                memo[rec] = (False, f'its record {rec} is NOT listed (exact path)')
            elif need == 'URL':
                okk = any(r.get('url') == check for r in hits)
                memo[rec] = (okk, f'{rec}: the pinned URL {check}' if okk else f'{rec} does not carry the pinned URL {check} (it has {sorted({r.get("url") for r in hits})})')
            else:
                okk = any(r['status'] == 'TEXT' and re.search(check, row_text(engine, r), re.I | re.S) for r in hits)
                memo[rec] = (okk, f'{rec}: a license text of the expected family' if okk else
                             f'{rec} has NO license text of the expected family (/{check}/; status {sorted({r["status"] for r in hits})})')
        okk, why = memo[rec]
        lines.append(f'  {"ok " if okk else "GAP"}  {f} -> {why}')
        if not okk:
            gaps.append(f)
    return lines, gaps


def required_statements(rows):
    return sorted({stmt for pat, stmt in REQUIRED_ATTRIBUTIONS
                   for r in rows if re.search(pat, ((r.get('name') or '') + ' ' + r['tps']), re.I)})


def write_notices(path, engine, rows, files):
    out = ['WONDERLAND PRIVATE BETA -- THIRD-PARTY SOFTWARE NOTICES', '',
           'This package includes third-party software. Each component below remains under its own license; nothing in',
           "Wonderland's own terms changes those licenses. The list comes from the Unreal Engine's own third-party records for",
           "this game target (Epic's ListThirdPartySoftware) and errs on the side of listing more. Epic's own notice is in",
           'NOTICES.txt beside this file.', '']
    req = required_statements(rows)
    if req:
        out += ['=' * 100, "REQUIRED ATTRIBUTIONS (statements the components' licenses require in the product documentation):", '']
        out += ['  ' + s for s in req] + ['']
    by_key = {}
    for r in rows:
        if r['status'] == 'TEXT':
            k = ('TEXT', tuple(r.get('license_files', [])), r.get('source_terms', ''))
        elif r['status'] == 'URL':
            k = ('URL', r.get('url', ''))
        else:
            continue
        by_key.setdefault(k, []).append(r)
    keyname = lambda k: ((by_key[k][0].get('name') or by_key[k][0]['tps']).lower(), str(k))
    for key in sorted(by_key, key=keyname):
        comps = by_key[key]
        names = sorted({c.get('name') or os.path.basename(c['tps']) for c in comps})
        out += ['=' * 100, 'Component(s): ' + '; '.join(names), 'Record(s): ' + '; '.join(sorted({c['tps'] for c in comps}))]
        if key[0] == 'URL':
            out += [f'License: {key[1]}', '']
            continue
        for lf in key[1]:
            body = read_text(os.path.join(engine, lf)).replace('\r\n', '\n').replace('\r', '\n').strip()
            out += [f'License text ({os.path.basename(lf)}):', '', body, '']
        if key[2]:
            out += ["License text (from the component's own source header):", '', key[2].replace('\r\n', '\n').strip(), '']
    nolic = sorted({(r.get('name') or os.path.basename(r['tps'])) + '  [' + r['tps'] + ']' for r in rows if r['status'] == 'UNRESOLVED'})
    if nolic:
        out += ['=' * 100, "Components listed in the engine's third-party records for which the logged search (the Licenses folder and",
                "its subfolders, the record's own and <Location> folders, the reviewed source headers) found no license text or URL",
                '(named for completeness; each bracket is the engine record):', ''] + ['  - ' + x for x in nolic] + ['']
    vt = [name for name, pat in VENDOR_TERMS if any(re.search(pat, x.split('pak:', 1)[-1], re.I) for x in files)]
    if vt:
        out += ['=' * 100, "Redistributed under their vendors' own terms (the engine holds no third-party record for them):", '']
        out += ['  - ' + x for x in vt]
    text = '\n'.join(out) + '\n'
    if '\ufffd' in text:
        raise Fail(f'the notices hold {text.count(chr(0xfffd))} U+FFFD replacement character(s)')
    m = DRIVE_PATH.search(text)
    if m:
        raise Fail('the notices hold an absolute machine path near: ' + text[max(0, m.start() - 40):m.start() + 60].replace('\n', ' '))
    with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(text)
    return len(by_key), req


def collect_files(shipped, ufs_manifest):
    files = []
    for dp, _, ns in os.walk(shipped):
        for n in ns:
            files.append(os.path.relpath(os.path.join(dp, n), shipped).replace(os.sep, '/'))
    packed = []
    if ufs_manifest:
        for raw in read_text(ufs_manifest).splitlines():
            p = raw.split('\t', 1)[0].strip()
            if p:
                packed.append('pak:' + p.replace('\\', '/'))
    return sorted(files), sorted(packed)


def build(tps_log, engine, out, shipped, ufs_manifest=None):
    assert not os.path.exists(out), f'{out} exists (never overwritten)'
    engine = os.path.normpath(engine)
    index = LicenseIndex(engine)
    records, stubs, folders, filetargets, junk = parse_tps_log(tps_log)
    if not records:
        raise Fail(f'no .tps record in {tps_log}: refusing to write notices from nothing')
    rows = [tps_row(engine, index, p, 'UAT ListThirdPartySoftware') for p in records]
    listed = {os.path.normcase(p) for p in records}
    extra = []
    for folder in folders:   # a redirect whose target is a folder: every record in it
        extra += [os.path.join(folder, n) for n in sorted(os.listdir(folder)) if n.lower().endswith('.tps')]
    files, packed = collect_files(shipped, ufs_manifest)
    for rel in sorted({os.path.dirname(f) for f in files if f.lower().startswith('engine/')}):
        for cand_dir in (os.path.join(engine, rel), os.path.dirname(os.path.join(engine, rel))):
            if os.path.isdir(cand_dir):
                for n in sorted(os.listdir(cand_dir)):
                    if n.lower().endswith('.tps'):
                        extra += follow_redirect(os.path.normpath(os.path.join(cand_dir, n)))
    beside = []
    for q in extra:
        q = os.path.normpath(q)
        if os.path.normcase(q) not in listed and os.path.isfile(q):
            listed.add(os.path.normcase(q))
            beside.append(q)
    rows += [tps_row(engine, index, p, 'beside a shipped binary / a redirect target') for p in beside]
    for stub, target in filetargets:   # a redirect to a non-.tps FILE: that file is the stub's license candidate
        if os.path.normcase(stub) in listed:
            continue
        listed.add(os.path.normcase(stub))
        r = tps_row(engine, index, stub, 'a redirect to a license file')
        if r['status'] != 'TEXT' and body_ok(read_text(target)):
            r.update(license_files=[os.path.relpath(target, engine)], resolved_by='redirect-target-file', status='TEXT')
        rows.append(r)
    for stub in junk:   # a redirect to nothing usable: the stub stays a named row, never dropped
        if os.path.normcase(stub) not in listed:
            listed.add(os.path.normcase(stub))
            rows.append(tps_row(engine, index, stub, 'a redirect to nothing usable'))
    os.makedirs(out)
    allfiles = files + packed
    sections, req = write_notices(os.path.join(out, 'THIRD_PARTY_NOTICES.txt'), engine, rows, allfiles)
    with open(os.path.join(out, 'notices_map.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(rows, f, indent=1, sort_keys=True)
    count = lambda s: sum(1 for r in rows if r['status'] == s)
    lines = [f'{len(rows)} .tps records ({len(records)} parsed from {os.path.basename(tps_log)}, {len(stubs)} redirect stubs named, '
             f'{len(beside)} beside the shipped binaries / redirect targets, {len(filetargets)} redirects to a file, {len(junk)} to nothing); '
             f'{sections} distinct license texts / URLs; TEXT {count("TEXT")}, URL {count("URL")}, UNRESOLVED (named, no text or URL) {count("UNRESOLVED")}',
             f'REQUIRED ATTRIBUTIONS printed: {len(req)}']
    chk, gaps = shipped_check(allfiles, rows, engine)
    lines.append(f'REDISTRIBUTED files in {os.path.basename(os.path.normpath(shipped))} ({len(files)} loose + {len(packed)} packed), each mapped:')
    lines += chk
    lines.append(f'GAPS: {len(gaps)}')
    with open(os.path.join(out, 'SUMMARY.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    return lines, gaps


def selftest():
    import tempfile
    results = []

    def case(name, ok):
        results.append((name, bool(ok)))

    APACHE = ('Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the '
              'License. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed '
              'on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND. Copyright and permission notices apply.')
    MIT = 'MIT License ' + ('Permission is hereby granted, free of charge, to any person obtaining a copy of this software. ' * 3)
    BSD = 'Copyright (c) 2002 Xiph.org Foundation ' + ('Redistribution and use in source and binary forms, with or without modification, are permitted. ' * 3)
    GPL = 'GNU GENERAL PUBLIC LICENSE Version 3 ' + ('Everyone is permitted to copy and distribute verbatim copies of this license document. ' * 3)
    NVL = 'NVIDIA Corporation Software License Agreement - SDK ' + ('IMPORTANT - READ BEFORE COPYING, INSTALLING OR USING. ' * 4)

    def T(tps, name, status='TEXT', text=None, url=''):
        r = {'tps': tps, 'name': name, 'status': status, 'url': url}
        if text is not None:
            r['license_text'] = text
        return r
    rows = [T('Engine\\Source\\ThirdParty\\MsQuic\\MsQuic.tps', 'MsQuic', text=MIT), T('Engine\\Source\\ThirdParty\\Ogg\\OggVorbis.tps', 'Ogg Vorbis', text=BSD)]
    msq = 'Engine/Binaries/ThirdParty/MsQuic/v220/win64/msquic.dll'
    base = ['Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe', msq, 'Engine/Binaries/ThirdParty/Ogg/Win64/VS2015/libogg_64.dll',
            'Engine/Binaries/Win64/EOSSDK-Win64-Shipping.dll', 'Wonderland/Binaries/Win64/vcruntime140.dll', 'README_BETA.txt',
            'Wonderland/Content/Paks/Wonderland-Windows.pak']
    case('C1 the known set maps clean', shipped_check(base, rows)[1] == [])
    case('C2 a planted UNMAPPED dll is a GAP', shipped_check(base + ['Engine/Binaries/ThirdParty/Planted/planted.dll'], rows)[1] == ['Engine/Binaries/ThirdParty/Planted/planted.dll'])
    case('C3 a planted loose font is a GAP', shipped_check(base + ['Wonderland/Content/Fonts/Planted.otf'], rows)[1] == ['Wonderland/Content/Fonts/Planted.otf'])
    case('C4 a mapped file whose record is NOT listed is a GAP', shipped_check(base + ['Wonderland/Binaries/Win64/tbb12.dll'], rows)[1] == ['Wonderland/Binaries/Win64/tbb12.dll'])
    case('C5 the game exe and the bootstrap are not GAPs', shipped_check(['Wonderland.exe', 'Wonderland/Binaries/Win64/Wonderland.exe'], rows)[1] == [])
    case('C6 a .pak / .txt is not a redistributed file', shipped_check(['Wonderland/Content/Paks/x.pak', 'NOTICES.txt'], rows)[1] == [])
    case('C7 an unknown DLL in a KNOWN folder is a GAP (exact names, reviewer 6 F5)',
         shipped_check(['Engine/Binaries/ThirdParty/MsQuic/v220/win64/libcrypto-3-x64.dll'], rows)[1] != [])
    case('C8 a VENDOR-folder DLL with no VENDOR_TERMS name is a GAP', shipped_check(['Engine/Binaries/ThirdParty/Windows/XAudio2_9/x64/planted_unknown.dll'], rows)[1] != []
         and shipped_check(['Wonderland/Binaries/Win64/vcruntime140_planted.dll'], rows)[1] != [])
    af = 'Engine/Binaries/ThirdParty/NVIDIA/NVaftermath/Win64/GFSDK_Aftermath_Lib.x64.dll'
    stub = T('Engine\\Binaries\\ThirdParty\\NVIDIA\\NVaftermath\\Aftermath.tps', '', 'UNRESOLVED')
    case('V1 a shipped DLL whose only record is an UNRESOLVED stub is a GAP', shipped_check([af], [stub])[1] == [af])
    AFT = 'Engine\\Source\\ThirdParty\\NVIDIA\\NVaftermath\\NVIDIA Aftermath SDK_v2025.5.0.251114 (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps'
    case('V2 ... and passes with its REAL record carrying the NVIDIA SDK license (v2.3: TEXT)', shipped_check([af], [stub, T(AFT, 'NVIDIA Aftermath SDK', text=NVL)])[1] == [])
    case('V2b R3: Aftermath with only its URL is now a GAP', shipped_check([af], [stub, T(AFT, 'NVIDIA Aftermath SDK', 'URL', url='https://developer.nvidia.com/nsight-aftermath')])[1] == [af])
    case('V3 a returning onnxruntime.dll is a GAP even WITH an ONNX Runtime record', shipped_check(
        ['Engine/Plugins/NNE/NNERuntimeORT/Binaries/ThirdParty/Onnxruntime/Win64/onnxruntime.dll'],
        rows + [T('Engine\\Plugins\\NNE\\NNERuntimeORT\\Source\\ThirdParty\\Onnxruntime\\Onnxruntime_v1.24.1.tps', 'ONNX Runtime')])[1] != [])
    case('V4 a font INSIDE the pak with no record is a GAP', shipped_check(['pak:Engine/Content/Slate/Fonts/DroidSansMono.ttf'], rows)[1] == ['pak:Engine/Content/Slate/Fonts/DroidSansMono.ttf'])
    case('V4b ... and Droid maps ONLY to its own AOSP record, never the onnxruntime one', shipped_check(['pak:Engine/Content/Slate/Fonts/DroidSansMono.ttf'],
         [T('Engine\\Plugins\\NNE\\NNERuntimeORT\\Source\\ThirdParty\\Onnxruntime\\The Android Open Source Project_vort.1.24.1.tps', 'The Android Open Source Project ort.1.24.1')])[1] != [])
    case('V5 a .ufont and the CA bundle inside the pak are judged', shipped_check(['pak:Engine/Content/EngineFonts/Faces/Planted.ufont', 'pak:Engine/Content/Certificates/ThirdParty/cacert.pem'], rows)[1]
         == ['pak:Engine/Content/Certificates/ThirdParty/cacert.pem', 'pak:Engine/Content/EngineFonts/Faces/Planted.ufont'])
    case('V5b a TEXT-required component with only a URL record is a GAP (URL_OK honoured only where mapped)',
         shipped_check([msq], [T('Engine\\Source\\ThirdParty\\MsQuic\\MsQuic.tps', 'MsQuic', 'URL')])[1] == [msq])
    tbb = 'Wonderland/Binaries/Win64/tbb12.dll'
    TBB = 'Engine\\Source\\ThirdParty\\Intel\\TBB\\oneTBB.tps'
    case('V17 R3 M1: oneTBB carrying a GPL text is a GAP', shipped_check([tbb], [T(TBB, 'oneTBB', text=GPL)])[1] == [tbb])
    case('V17b R3 M1: oneTBB carrying MsQuic\'s MIT text is a GAP', shipped_check([tbb], [T(TBB, 'oneTBB', text=MIT)])[1] == [tbb])
    case('V18 R3 M2: MsQuic under a planted record path is a GAP', shipped_check([msq], [T('Engine\\Plugins\\Planted\\Source\\ThirdParty\\MsQuic\\MsQuic.tps', 'MsQuic', text=MIT)])[1] == [msq])
    dbg = 'Engine/Binaries/ThirdParty/DbgHelp/dbghelp.dll'
    DBG = 'Engine\\Binaries\\ThirdParty\\DbgHelp\\dbghelp.tps'
    case('V19 R3 m2: dbghelp with another URL is a GAP; with the pinned one it maps', shipped_check([dbg], [T(DBG, 'DbgHelp', 'URL', url='http://example.invalid/')])[1] == [dbg]
         and shipped_check([dbg], [T(DBG, 'DbgHelp', 'URL', url='https://docs.microsoft.com/en-us/legal/windows-sdk/license-terms-ewdk')])[1] == [])
    case('V20 R3 B1: an unclassified packed type is a GAP; Epic / own content is not', shipped_check(['pak:Engine/Content/Planted/data.xyz'], rows)[1] == ['pak:Engine/Content/Planted/data.xyz']
         and shipped_check(['pak:Engine/Content/Maps/Entry.umap', 'Engine/Config/StagedBuild_Wonderland.ini', 'Wonderland/UiArt/x.png', 'pak:Engine/Content/Slate/Common/menu.svg'], rows)[1] == [])
    icu = 'pak:Engine/Content/Internationalization/icudt64l/brkitr/char.brk'
    ICU = T('Engine\\Source\\ThirdParty\\ICU\\ICU_64-1.tps', 'ICU 64.1', text='COPYRIGHT AND PERMISSION NOTICE (ICU 58 and later) ' + ('Permission is hereby granted, free of charge, to any person obtaining a copy of the Unicode data files. ' * 2))
    case('V21 R3 B1: an ICU data file maps to the ICU 64.1 record\'s Unicode notice, and is a GAP without it', shipped_check([icu], [ICU])[1] == [] and shipped_check([icu], rows)[1] == [icu])
    case('V22 R3: a file under a ThirdParty folder is never OWN', shipped_check(['Engine/Binaries/ThirdParty/Planted/readme.txt'], rows)[1] == ['Engine/Binaries/ThirdParty/Planted/readme.txt'])
    with tempfile.TemporaryDirectory() as td:
        log = os.path.join(td, 'l.log')
        eng = os.path.join(td, 'E')
        os.makedirs(os.path.join(eng, 'Engine', 'X'))
        target_file = os.path.join(eng, 'Engine', 'X', 'LICENSE.txt')
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(APACHE)
        with open(log, 'w', encoding='utf-8') as f:
            f.write('Starting AutomationTool...\n'
                    'C:\\E\\Engine\\Source\\ThirdParty\\NVIDIA\\NVaftermath\\NVIDIA Aftermath SDK_v1 (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps\n'
                    'C:\\E\\Engine\\Source\\Runtime\\Core\\Public\\Math\\ApproximatingSine()CurvesSnippets.tps\n'
                    'C:\\E\\Engine\\Build\\A.tps (redirect from C:\\E\\Engine\\Content\\B (x).tps)\n'
                    f'{os.path.join(eng, "Engine", "X")} (redirect from C:\\E\\Engine\\Shaders\\Agslib.tps)\n'
                    f'{target_file} (redirect from C:\\E\\Engine\\Y\\Y.tps)\n'
                    'C:\\E\\Engine\\Z\\<\\Notification> (redirect from C:\\E\\Engine\\Z\\Z.tps)\n')
        recs, stubs, folders, ft, junk = parse_tps_log(log)
        case('V6 parenthesised paths and every redirect form parse; nothing is dropped',
             len(recs) == 3 and any('(e2e87085' in r for r in recs) and any('ApproximatingSine()' in r for r in recs)
             and len(stubs) == 4 and len(folders) == 1 and len(ft) == 1 and len(junk) == 1)
        with open(log, 'a', encoding='utf-8') as f:
            f.write('garbage C:\\E\\x.tps trailing words\n')
        try:
            parse_tps_log(log)
            case('V7 an unparseable .tps line is an ERROR', False)
        except Fail:
            case('V7 an unparseable .tps line is an ERROR', True)
        lic = os.path.join(eng, 'Engine', 'Source', 'ThirdParty', 'Licenses')
        tiff = os.path.join(eng, 'Engine', 'Source', 'ThirdParty', 'LibTiff')
        os.makedirs(os.path.join(lic, 'Sub'))
        os.makedirs(tiff)
        with open(os.path.join(lic, 'LibTiff_License.txt'), 'wb') as f:
            f.write(('Copyright \xa9 1988 Sam Leffler. ' + APACHE).encode('cp1252'))
        with open(os.path.join(lic, 'libPNG_v1.6.44_License.txt'), 'w', encoding='utf-8') as f:
            f.write('PNG ' + APACHE)
        with open(os.path.join(lic, 'HarfBuzz_License.txt'), 'w', encoding='utf-8') as f:
            f.write('HB ' + APACHE)
        with open(os.path.join(lic, 'HarfBuzz_UCDN_License.txt'), 'w', encoding='utf-8') as f:
            f.write('UCDN ' + APACHE)
        with open(os.path.join(lic, 'Sub', 'Nested_License.txt'), 'w', encoding='utf-8') as f:
            f.write('Nested ' + APACHE)
        with open(os.path.join(lic, 'Aftermath SDK_v1 (a5c10ac5-23d6-4a87-9630-a522f9e02023).license'), 'w', encoding='utf-8') as f:
            f.write('License\n"=====\nSoftware Name: Aftermath SDK\nVersion: 1\nURL: https://developer.example/aftermath\n=====\n"\n')
        with open(os.path.join(tiff, 'libtiff.tps'), 'w', encoding='utf-8') as f:
            f.write('<TpsData><Name>libtiff</Name><LicenseFolder>Engine/Source/ThirdParty/LibTiff</LicenseFolder><Eula>https://x</Eula></TpsData>')
        idx = LicenseIndex(eng)
        r = tps_row(eng, idx, os.path.join(tiff, 'libtiff.tps'), 't')
        case('V8 a .tps is never its own license; the folder hint resolves by name (libtiff -> LibTiff_License.txt)',
             r['status'] == 'TEXT' and r['license_files'] == [os.path.join('Engine', 'Source', 'ThirdParty', 'Licenses', 'LibTiff_License.txt')])
        case('V9 a cp1252 license decodes without U+FFFD', 'Copyright \xa9 1988' in read_text(os.path.join(lic, 'LibTiff_License.txt')))
        files, how, _, _ = resolve_license(eng, idx, {'license_folder': '//UE5/Main/Engine/Source/ThirdParty/Licenses/HarfBuzz*', 'name': 'HarfBuzz'}, 'h.tps')
        case('V10 a depot-style glob resolves every matching file', how == 'glob' and len(files) == 2)
        files, how, _, _ = resolve_license(eng, idx, {'license_folder': '/Engine/Source/ThirdParty/Licenses', 'name': 'libpng'}, 'LibPNG_v1.6.44.tps')
        case('V11 the generic folder resolves a versioned record by name', how == 'by-name' and len(files) == 1)
        files, how, _, _ = resolve_license(eng, idx, {'license_folder': '', 'name': 'Nested'}, 'Nested.tps')
        case('V11b the Licenses SUBFOLDERS are searched too', how == 'by-name' and len(files) == 1)
        hdr = os.path.join(eng, 'Engine', 'Source', 'ThirdParty', 'NV')
        os.makedirs(hdr)
        with open(os.path.join(hdr, 'Aftermath SDK_v1 (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps'), 'w', encoding='utf-8') as f:
            f.write('<TpsData><Name>Aftermath SDK</Name><LicenseFolder>/Engine/Source/ThirdParty/Licenses</LicenseFolder></TpsData>')
        r = tps_row(eng, idx, os.path.join(hdr, 'Aftermath SDK_v1 (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps'), 't')
        case('V11c a HEADER-ONLY license file is not a text: the record falls back to the header URL (reviewer 6 F1)',
             r['status'] == 'URL' and r['url'] == 'https://developer.example/aftermath' and r['search']['rejected_no_body'])
        own = os.path.join(eng, 'Engine', 'Plugins', 'R')
        os.makedirs(own)
        with open(os.path.join(own, 'LICENSE'), 'w', encoding='utf-8') as f:
            f.write(APACHE)
        with open(os.path.join(own, 'R.tps'), 'w', encoding='utf-8') as f:
            f.write('<TpsData><Name>Resonance</Name></TpsData>')
        r = tps_row(eng, idx, os.path.join(own, 'R.tps'), 't')
        case("V11d a LICENSE in the record's OWN folder is found (reviewer 6 F3)", r['status'] == 'TEXT' and r['resolved_by'] == 'record-folder')
        try:
            write_notices(os.path.join(td, 'n.txt'), eng, [{'tps': 'x', 'name': 'C:\\Users\\someone\\leak', 'status': 'UNRESOLVED'}], [])
            case('V12 an absolute machine path in the notices is an ERROR', False)
        except Fail:
            case('V12 an absolute machine path in the notices is an ERROR', True)
        bad = os.path.join(lic, 'Bad_License.txt')
        with open(bad, 'w', encoding='utf-8') as f:
            f.write('Bad ' + APACHE + ' \ufffd')
        try:
            write_notices(os.path.join(td, 'n2.txt'), eng, [{'tps': 'Engine\\Bad.tps', 'name': 'Bad', 'status': 'TEXT',
                                                             'license_files': [os.path.relpath(bad, eng)]}], [])
            case('V12b a U+FFFD in the notices is an ERROR', False)
        except Fail:
            case('V12b a U+FFFD in the notices is an ERROR', True)
        os.remove(bad)
        n3 = os.path.join(td, 'n3.txt')
        write_notices(n3, eng, [{'tps': 'Engine\\Source\\ThirdParty\\libjpeg-turbo\\libjpeg-turbo.tps', 'name': 'libjpeg-turbo', 'status': 'URL', 'url': 'https://x'},
                                {'tps': 'Engine\\Source\\ThirdParty\\FreeType2\\Freetype2.tps', 'name': 'FreeType', 'status': 'URL', 'url': 'https://y'}], [])
        written = read_text(n3)
        case('V13 the WRITTEN notices carry the IJG and the FreeType statements',
             'Independent JPEG Group' in written and 'FreeType Team' in written and 'Record(s): ' in written)
        missing = os.path.join(eng, 'Engine', 'Build', 'Android', 'Java', 'AndroidOpenSourceProject.tps')
        r = tps_row(eng, idx, missing, 't')
        case('V14 a listed record MISSING on disk stays a named row with its logged search',
             r.get('record_missing') and r['name'] == 'AndroidOpenSourceProject' and 'keys' in r['search'])
        case('V15 name keys: a separated version goes, an inner digit stays (Caffe2), "lib" and a guid go',
             'caffe2' in name_keys('Caffe2') and 'caffe' not in name_keys('Caffe2') and 'libpng' in name_keys('libpng_v1.6.44')
             and 'opus' in name_keys('LibOpus') and 'aftermathsdk' in name_keys('Aftermath SDK_v1 (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps')
             and 'harfbuzz' in name_keys('Harfbuzz_v12.2.0'))
        stubdir = os.path.join(eng, 'Engine', 'Binaries', 'S')
        os.makedirs(stubdir)
        realdir = os.path.join(eng, 'Engine', 'Source', 'S')
        os.makedirs(realdir)
        with open(os.path.join(realdir, 'Real (e2e87085-29ce-4eef-9a5c-7496689bcf5b).tps'), 'w', encoding='utf-8') as f:
            f.write('<TpsData><Name>Real</Name></TpsData>')
        with open(os.path.join(stubdir, 'S.tps'), 'w', encoding='utf-8') as f:
            f.write('<TpsData>\n  <Name />\n  <Notification>\nRedirect: ../../Source/S/S.tps\n  </Notification>\n</TpsData>\n')
        got = follow_redirect(os.path.join(stubdir, 'S.tps'))
        case('V16 a Redirect stub is followed to the real record(s) in its target folder', len(got) == 1 and 'Real (' in got[0])
    bad = [n for n, ok in results if not ok]
    for n, ok in results:
        print(f'{"ok  " if ok else "BAD "} {n}')
    print(f'SELFTEST {"PASS" if not bad else "FAIL"} ({len(results) - len(bad)} of {len(results)})')
    return not bad


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 2)
    ap = argparse.ArgumentParser()
    ap.add_argument('--tps-log', required=True)
    ap.add_argument('--engine', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--shipped', required=True)
    ap.add_argument('--ufs-manifest')
    A = ap.parse_args()
    try:
        lines, gaps = build(A.tps_log, A.engine, A.out, A.shipped, A.ufs_manifest)
    except Fail as e:
        print('ERROR: ' + str(e))
        sys.exit(2)
    print('\n'.join(lines))
    sys.exit(1 if gaps else 0)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException as e:   # any crash is an ERROR, never mistaken for a GAP
        print(f'ERROR: {type(e).__name__}: {e}')
        sys.exit(2)
