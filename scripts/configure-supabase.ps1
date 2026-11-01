# Run locally; values are entered here, never in chat or command history.
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot '..\.env.local'
$configText = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\.env.example')) }
foreach ($configName in @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY')) {
    $secureValue = Read-Host "Enter $configName (hidden)" -AsSecureString
    $valuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        $configValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($valuePointer)
        if ([string]::IsNullOrWhiteSpace($configValue) -or $configValue -match '[\r\n"`$]') { throw "Invalid value for $configName" }
        if ($configName -eq 'NEXT_PUBLIC_SUPABASE_URL' -and $configValue -notmatch '^https://[^/]+/?$') { throw 'Use the HTTPS Supabase project URL' }
        $configLine = $configName + '=' + $configValue
        $configPattern = '(?m)^' + [regex]::Escape($configName) + '=.*$'
        if ([regex]::IsMatch($configText,$configPattern)) { $configText = [regex]::Replace($configText,$configPattern,[System.Text.RegularExpressions.MatchEvaluator]{param($match) $configLine}) }
        else { $configText += "`n$configLine`n" }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($valuePointer); $configValue = $null }
}
[IO.File]::WriteAllText($configPath,$configText,[Text.UTF8Encoding]::new($false))
$configText = $null
Write-Host 'Saved .env.local. Restart Next.js or rebuild to load the configuration.'
