[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('nvidia', 'amd', 'cpu')]
    [string]$Backend
)

# This script only prints a sanitized PATH.  The caller (the batch launcher)
# applies it to its own process so every Angular/Tauri child inherits the same
# backend boundary.  Do not mutate the user's persistent environment.
$dropPatterns = switch ($Backend) {
    'nvidia' { @('(?i)(^|[\\/])(rocm|hip|miopen|rocprofiler)(?:[\\/]|-|$)') }
    'amd'    { @('(?i)(^|[\\/])(cuda|cudnn)(?:[\\/]|-|$)', '(?i)nvidia[\\/](gpu computing toolkit|cudnn)') }
    'cpu'    { @(
        '(?i)(^|[\\/])(cuda|cudnn|rocm|hip|miopen|rocprofiler)(?:[\\/]|-|$)',
        '(?i)nvidia[\\/](gpu computing toolkit|cudnn)'
    ) }
}

$path = [Environment]::GetEnvironmentVariable('PATH', 'Process')
$kept = [System.Collections.Generic.List[string]]::new()
foreach ($entry in ($path -split ';')) {
    $candidate = $entry.Trim()
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        continue
    }

    $drop = $false
    foreach ($pattern in $dropPatterns) {
        if ($candidate -match $pattern) {
            $drop = $true
            break
        }
    }
    if (-not $drop) {
        [void]$kept.Add($candidate)
    }
}

[Console]::WriteLine(($kept -join ';'))
