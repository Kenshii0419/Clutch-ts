$path = 'public/css/style.css'
$lines = [System.IO.File]::ReadAllLines($path)
$out = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Length; $i++) {
  $l = $lines[$i]
  if ($l -eq '  background: linear-gradient(135deg, #44266E 0%, #59345F 50%, #6D4AFF 100%);') { $l = '  background: linear-gradient(135deg, var(--deep-purple) 0%, var(--brand-purple) 55%, var(--deep-purple) 100%);' }
  if ($l -eq '  background: radial-gradient(circle, rgba(233, 223, 255, 0.15) 0%, transparent 70%);') { $l = '  background: radial-gradient(circle, rgba(115, 123, 76, 0.10) 0%, transparent 70%);' }
  if ($l -eq '  background: rgba(233, 223, 255, 0.15);' -and $i + 1 -lt $lines.Length -and $lines[$i + 1] -eq '  backdrop-filter: blur(10px);') { $l = '  background: rgba(115, 123, 76, 0.12);' }
  if ($l -eq '  border: 1px solid rgba(233, 223, 255, 0.3);') { $l = '  border: 1px solid rgba(115, 123, 76, 0.35);' }
  if ($l -eq '  background: linear-gradient(135deg, #E9DFFF 0%, #FFFFFF 100%);') { $l = '  background: linear-gradient(135deg, #D9DDB3 0%, #FFFFFF 100%);' }
  if ($l -eq '  background: rgba(233, 223, 255, 0.15);' -and $i + 1 -lt $lines.Length -and $lines[$i + 1] -eq '  border-radius: var(--radius-md);') { $l = '  background: rgba(115, 123, 76, 0.10);' }
  if ($l -eq '  box-shadow: 0 0 0 3px rgba(109, 74, 255, 0.12);') { $l = '  box-shadow: 0 0 0 3px rgba(109, 113, 46, 0.12);' }
  if ($l -eq '  color: #6366f1;') { $l = '  color: var(--brand-purple);' }
  $out.Add($l)
  if ($l -eq '  align-items: center;' -and $i -gt 0 -and $out[$out.Count - 2] -eq '  padding: 0;') { $out.Add('  gap: 0.85rem;') }
  if ($l -eq '.cart-badge { position: relative; color: var(--text-primary); text-decoration: none; }') {
    $out.Add('')
    $out.Add('.cart-badge:hover {')
    $out.Add('  background: var(--border-light);')
    $out.Add('  border-radius: var(--radius);')
    $out.Add('}')
  }
  if ($l -eq '.footer-corner-logo {') {
    $out.Add('@media (max-width: 640px) {')
    $out.Add('  .mobile-menu-btn { display: flex; }')
    $out.Add('  .nav-list { display: none; }')
    $out.Add('  .nav-actions { display: none; }')
    $out.Add('}')
    $out.Add('')
  }
}
[System.IO.File]::WriteAllLines($path, $out.ToArray())
write-output ('Done. Lines: ' + $out.Count)
