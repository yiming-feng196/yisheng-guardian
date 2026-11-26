from pathlib import Path
import concurrent.futures, hashlib, json, urllib.request, urllib.parse, zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime/native-tools'
DOWNLOADS = ROOT / '.runtime/downloads'
DOWNLOADS.mkdir(parents=True, exist_ok=True)
RUNTIME.mkdir(parents=True, exist_ok=True)
headers = {'User-Agent': 'Yisheng-local-development'}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45)

def install(spec):
    name, url, check_url, algorithm, expected = spec
    if not expected:
        with get(check_url) as r: expected = r.read().decode().split()[0]
    archive = DOWNLOADS / (name + '.zip')
    valid = archive.exists() and hashlib.new(algorithm,archive.read_bytes()).hexdigest().lower() == expected.lower()
    actual_url = url
    if not valid:
        print('Downloading '+name,flush=True)
        with get(url) as r, archive.open('wb') as f:
            actual_url = r.url
            while chunk := r.read(1024*1024): f.write(chunk)
    digest = hashlib.new(algorithm,archive.read_bytes()).hexdigest()
    if digest.lower() != expected.lower(): raise RuntimeError(name+' checksum mismatch')
    dest = RUNTIME / name
    dest.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            if not (dest/member.filename).resolve().is_relative_to(dest.resolve()): raise RuntimeError('Archive path outside destination')
        z.extractall(dest)
    print('Installed '+name+'; upstream checksum verified',flush=True)
    return {'name':name,'url':actual_url,'algorithm':algorithm,'checksum':digest,'directory':str(dest)}

specs = [
 ('java','https://corretto.aws/downloads/latest/amazon-corretto-17-x64-windows-jdk.zip','https://corretto.aws/downloads/latest_sha256/amazon-corretto-17-x64-windows-jdk.zip','sha256',None),
 ('maven','https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.12/apache-maven-3.9.12-bin.zip','https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.12/apache-maven-3.9.12-bin.zip.sha512','sha512',None),
 ('redis','https://github.com/redis-windows/redis-windows/releases/download/8.10.3/Redis-8.10.3-Windows-x64-msys2.zip',None,'sha256','af16df340525b431e9ec8dabfd625d5e7a233f82805b5418819904ea909c447f')
]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(install,specs))
(RUNTIME/'tools-lock.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
settings=ET.Element('settings',xmlns='http://maven.apache.org/SETTINGS/1.0.0')
proxy=urllib.request.getproxies().get('https') or urllib.request.getproxies().get('http')
if proxy:
    url=urllib.parse.urlsplit(proxy)
    entries=ET.SubElement(settings,'proxies')
    for protocol in ('http','https'):
        entry=ET.SubElement(entries,'proxy')
        for key,value in {'id':'local-'+protocol,'active':'true','protocol':protocol,'host':url.hostname,'port':str(url.port),'nonProxyHosts':'localhost|127.*'}.items(): ET.SubElement(entry,key).text=value
        if url.username: ET.SubElement(entry,'username').text=urllib.parse.unquote(url.username)
        if url.password: ET.SubElement(entry,'password').text=urllib.parse.unquote(url.password)
ET.ElementTree(settings).write(ROOT/'.runtime/maven-settings.xml',encoding='utf-8',xml_declaration=True)
print('Native development tools ready.',flush=True)
