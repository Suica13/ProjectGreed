"""Build a signed test APK using only JDK 17+ and Android SDK 35 build tools.
Run npm run build first. Set ANDROID_HOME and optionally PROJECTGREED_ANDROID_KEYSTORE.
The generated test signing key must be preserved to install future builds as updates.
"""
import os, pathlib, subprocess, shutil, zipfile, xml.etree.ElementTree as ET
root = pathlib.Path(__file__).resolve().parent.parent
sdk = pathlib.Path(os.environ['ANDROID_HOME'])
bt = sdk / 'build-tools' / '35.0.0'
jar = sdk / 'platforms' / 'android-35' / 'android.jar'
out = root / 'dist' / 'android'
out.mkdir(parents=True, exist_ok=True)
classes = out / 'classes'; classes.mkdir(exist_ok=True)
dex = out / 'dex'; dex.mkdir(exist_ok=True)
def run(*args): subprocess.run([str(a) for a in args], check=True)
run('javac', '-source', '8', '-target', '8', '-classpath', jar, '-d', classes, *sorted((root/'android/app/src/main/java').rglob('*.java')))
run('java', '-cp', bt/'lib/d8.jar', 'com.android.tools.r8.D8', '--min-api', '26', '--lib', jar, '--output', dex, *sorted(classes.rglob('*.class')))
ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ns)
manifest = ET.parse(root/'android/app/src/main/AndroidManifest.xml')
m = manifest.getroot(); m.set('package', 'com.suica13.projectgreed')
m.set('{'+ns+'}versionCode','5002'); m.set('{'+ns+'}versionName','0.50.0-android-test2')
manifest.write(out/'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
assets=out/'assets';assets.mkdir(exist_ok=True)
shutil.copyfile(root/'public/client.html',assets/'client.html')
run(bt/'aapt2', 'link', '-o', out/'unsigned.apk', '-I', jar, '--manifest',out/'AndroidManifest.xml', '--min-sdk-version','26','--target-sdk-version','35','-A',assets)
with zipfile.ZipFile(out/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:
 for f in dex.glob('*.dex'): z.write(f, f.name)
run(bt/'zipalign','-f','4',out/'unsigned.apk',out/'aligned.apk')
key=pathlib.Path(os.environ.get('PROJECTGREED_ANDROID_KEYSTORE',str(out/'projectgreed-test.jks')))
if not key.exists():
 run('keytool','-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','projectgreed-test','-dname','CN=ProjectGreed Test','-keyalg','RSA','-keysize','2048','-validity','10000')
apk=out/'ProjectGreed-0.50.0-android-test2.apk'
run(bt/'apksigner','sign','--ks',key,'--ks-pass','pass:android','--key-pass','pass:android','--ks-key-alias','projectgreed-test','--out',apk,out/'aligned.apk')
run(bt/'apksigner','verify','--verbose',apk)
run(bt/'aapt2','dump','badging',apk)
print(apk)
