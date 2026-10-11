'use strict';
const { powershell } = require('./process');
async function scanInstalled(includeUser = true) {
  if (process.platform !== 'win32') throw new Error('Otomatik uygulama taraması Windows için destekleniyor.');
  const script = `
$items = [System.Collections.Generic.List[object]]::new()
$hives = @([Microsoft.Win32.RegistryHive]::LocalMachine${includeUser ? ', [Microsoft.Win32.RegistryHive]::CurrentUser' : ''})
foreach ($hive in $hives) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    $root = $base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
    if ($root) {
      foreach ($sub in $root.GetSubKeyNames()) {
        $key = $root.OpenSubKey($sub)
        if (!$key) { continue }
        try {
          $name = [string]$key.GetValue('DisplayName', '')
          if (!$name -or $key.GetValue('SystemComponent', 0) -eq 1) { continue }
          $items.Add([pscustomobject]@{
            name=$name; version=[string]$key.GetValue('DisplayVersion',''); publisher=[string]$key.GetValue('Publisher','');
            date=[string]$key.GetValue('InstallDate',''); location=[string]$key.GetValue('InstallLocation','');
            size=[long]$key.GetValue('EstimatedSize',0); scope=if ($hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser) {'user'} else {'machine'};
            architecture=if ($view -eq [Microsoft.Win32.RegistryView]::Registry32) {'x86'} else {'x64'}
          })
        } finally { $key.Dispose() }
      }
      $root.Dispose()
    }
    $base.Dispose()
  }
}
ConvertTo-Json -InputObject @($items.ToArray()) -Depth 4 -Compress
`;
  const entries = JSON.parse((await powershell(script, { timeout: 60000 })).replace(/^\uFEFF/, '').trim());
  const unique = new Map();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const old = unique.get(key);
    if (!old || Object.values(entry).filter(Boolean).length > Object.values(old).filter(Boolean).length) unique.set(key, entry);
  }
  return [...unique.values()].map(p => ({ ...p, date: /^(\d{4})(\d{2})(\d{2})$/.test(p.date) ? p.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$3.$2.$1') : p.date,
    size: p.size > 1048576 ? (p.size / 1048576).toFixed(1) + ' GB' : p.size > 1024 ? Math.round(p.size / 1024) + ' MB' : p.size ? p.size + ' KB' : ''
  })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
module.exports = { scanInstalled };
