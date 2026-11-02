// Вшивает иконку и сведения о программе в NoteApp.exe после упаковки.
// Делаем это сами через rcedit, потому что встроенный шаг electron-builder
// скачивает winCodeSign, который без прав администратора / режима разработчика
// не распаковывается в Windows — и exe остаётся с иконкой Electron.
const path = require('path');
const rcedit = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const info = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const root = context.packager.projectDir;
  console.log(`  • rcedit: иконка и сведения → ${path.basename(exe)}`);
  await rcedit(exe, {
    icon: path.join(root, 'assets', 'icon.ico'),
    'file-version': info.shortVersion || info.version,
    'product-version': info.shortVersion || info.version,
    'version-string': {
      ProductName: info.productName,
      FileDescription: info.productName,
      InternalName: info.productFilename,
      OriginalFilename: `${info.productFilename}.exe`,
      CompanyName: info.companyName || info.productName,
      LegalCopyright: info.copyright || '',
    },
  });
};
