$ErrorActionPreference = 'Stop'
$dir = "d:\Trae solo Demo  01\crm-mvp"
$css = Get-Content "$dir\styles.css" -Raw
$jsFiles = Get-ChildItem "$dir\js" -Filter *.js | Where-Object { $_.Name -ne 'mock.js' }

foreach ($f in $jsFiles) {
  $content = Get-Content $f.FullName -Raw
  $classes = [regex]::Matches($content, 'class="([^"]+)"') | ForEach-Object { $_.Groups[1].Value -split '\s+' } | Sort-Object -Unique
  $missing = @()
  foreach ($c in $classes) {
    if ($c -and -not $css.Contains('.' + $c)) { $missing += $c }
  }
  if ($missing.Count) {
    Write-Output ("== " + $f.Name + " ==")
    $missing | ForEach-Object { Write-Output ("   " + $_) }
  }
}
Write-Output "--- done ---"
