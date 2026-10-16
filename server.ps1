param([int]$Port = 8080, [switch]$NoBrowser)

# Visualisation Skin Gmod - serveur local
# Sert le site (dossier public) et recupere les addons du Workshop.
# Les addons ne sont jamais conserves : ils transitent par un dossier temporaire
# et sont supprimes des qu'ils ont ete envoyes au navigateur.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root        = $PSScriptRoot
$PublicDir   = Join-Path $Root 'public'
$AppDataDir  = Join-Path $env:LOCALAPPDATA 'VisualisationSkinGmod'
$TempDir     = Join-Path $env:TEMP 'VisualisationSkinGmod'
$SteamCmdDir = Join-Path $AppDataDir 'steamcmd'
$SteamCmdExe = Join-Path $SteamCmdDir 'steamcmd.exe'
$GmodAppId   = 4000
$MaxAgeMin   = 30

# On repart toujours d'un dossier temporaire vide
if (Test-Path $TempDir) { Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force $TempDir | Out-Null

# id -> etat du telechargement en cours
$Jobs = @{}

$Mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

function Send-Bytes($ctx, [byte[]]$bytes, [string]$type, [int]$status = 200) {
    $res = $ctx.Response
    $res.StatusCode = $status
    $res.ContentType = $type
    $res.Headers['Cache-Control'] = 'no-store'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Send-Json($ctx, $obj, [int]$status = 200) {
    $json = ConvertTo-Json $obj -Depth 6 -Compress
    Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $status
}

function Send-File($ctx, [string]$path, [string]$type) {
    $res = $ctx.Response
    $fs = [IO.File]::OpenRead($path)
    try {
        $res.StatusCode = 200
        $res.ContentType = $type
        $res.Headers['Cache-Control'] = 'no-store'
        $res.ContentLength64 = $fs.Length
        $fs.CopyTo($res.OutputStream)
        $res.OutputStream.Close()
    } finally { $fs.Dispose() }
}

function Get-WorkshopId([string]$text) {
    if (-not $text) { return $null }
    if ($text -match '[?&]id=(\d+)') { return $Matches[1] }
    if ($text.Trim() -match '^\d+$') { return $text.Trim() }
    if ($text -match '/(\d{6,})') { return $Matches[1] }
    return $null
}

function Get-FileDetails([string[]]$ids) {
    $body = @{ itemcount = $ids.Count }
    for ($i = 0; $i -lt $ids.Count; $i++) { $body["publishedfileids[$i]"] = $ids[$i] }
    $r = Invoke-RestMethod -Method Post -Uri 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/' -Body $body -TimeoutSec 20
    return @($r.response.publishedfiledetails)
}

function Get-CollectionChildren([string]$id) {
    $body = @{ collectioncount = 1; 'publishedfileids[0]' = $id }
    $r = Invoke-RestMethod -Method Post -Uri 'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/' -Body $body -TimeoutSec 20
    $c = @($r.response.collectiondetails)[0]
    if ($c.result -ne 1 -or -not $c.children) { return @() }
    return @($c.children | ForEach-Object { [string]$_.publishedfileid })
}

function Get-AddonFile([string]$id) {
    if (-not $id) { return $null }
    $f = Join-Path (Join-Path $TempDir $id) 'addon.dat'
    if (Test-Path $f) { return $f }
    return $null
}

function Remove-Addon([string]$id) {
    $Jobs.Remove($id)
    $dir = Join-Path $TempDir $id
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}

# Supprime les addons telecharges mais jamais recuperes par le navigateur
function Clear-Stale {
    $limit = (Get-Date).AddMinutes(-$MaxAgeMin)
    Get-ChildItem -Path $TempDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $job = $Jobs[$_.Name]
        if ($job -and $job.state -eq 'downloading') { return }
        if ($_.LastWriteTime -lt $limit) { Remove-Addon $_.Name }
    }
}

function Install-SteamCmd {
    if (Test-Path $SteamCmdExe) { return }
    New-Item -ItemType Directory -Force $SteamCmdDir | Out-Null
    $zip = Join-Path $SteamCmdDir 'steamcmd.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $SteamCmdDir -Force
    Remove-Item $zip
}

function Start-SteamCmdDownload($job) {
    Install-SteamCmd
    $log = Join-Path $job.dir 'steamcmd.log'
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = "/c `"`"$SteamCmdExe`" +login anonymous +workshop_download_item $GmodAppId $($job.id) +quit > `"$log`" 2>&1`""
    $psi.WorkingDirectory = $SteamCmdDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $job.process = [Diagnostics.Process]::Start($psi)
    $job.method = 'steamcmd'
    $job.attempt++
    $job.log = $log
}

function Start-Download($details) {
    $id = [string]$details.publishedfileid
    $dir = Join-Path $TempDir $id
    New-Item -ItemType Directory -Force $dir | Out-Null
    $job = @{ id = $id; dir = $dir; state = 'downloading'; error = $null; attempt = 0; size = [int64]$details.file_size; started = Get-Date }
    $Jobs[$id] = $job

    if ($details.file_url) {
        # Ancien addon : fichier direct (compresse en LZMA)
        $tmp = Join-Path $dir 'download.tmp'
        $wc = New-Object Net.WebClient
        $job.method = 'http'
        $job.tmp = $tmp
        $job.task = $wc.DownloadFileTaskAsync([Uri]$details.file_url, $tmp)
    } else {
        Start-SteamCmdDownload $job
    }
}

function Update-Job($job) {
    if ($job.state -ne 'downloading') { return }
    $final = Join-Path $job.dir 'addon.dat'

    if ($job.method -eq 'http') {
        if (-not $job.task.IsCompleted) { return }
        if ($job.task.IsFaulted) {
            $job.state = 'error'; $job.error = 'http: ' + $job.task.Exception.InnerException.Message
            return
        }
        Move-Item -Force $job.tmp $final
        $job.state = 'ready'
        return
    }

    # steamcmd
    if (-not $job.process.HasExited) { return }
    $contentDir = Join-Path $SteamCmdDir "steamapps\workshop\content\$GmodAppId\$($job.id)"
    $found = $null
    if (Test-Path $contentDir) {
        $found = Get-ChildItem -Path $contentDir -File | Where-Object { $_.Extension -in '.gma', '.bin' } | Sort-Object Length -Descending | Select-Object -First 1
    }
    if ($found) {
        Move-Item -Force $found.FullName $final
        Remove-Item -Recurse -Force $contentDir -ErrorAction SilentlyContinue
        $job.state = 'ready'
        return
    }
    if ($job.attempt -lt 3) {
        # steamcmd echoue parfois (timeout, mise a jour) : on reessaie
        Start-SteamCmdDownload $job
        return
    }
    $tail = ''
    if (Test-Path $job.log) { $tail = (Get-Content $job.log -Tail 6) -join "`n" }
    $job.state = 'error'
    $job.error = "steamcmd: $tail"
}

function Get-JobStatus([string]$id) {
    $job = $Jobs[$id]
    if ($job) { Update-Job $job }
    $f = Get-AddonFile $id
    if ($f) { return @{ status = 'ready'; size = (Get-Item $f).Length } }
    if (-not $job) { return @{ status = 'unknown' } }
    if ($job.state -eq 'error') {
        $err = $job.error
        Remove-Addon $id
        return @{ status = 'error'; error = $err }
    }
    $done = 0
    if ($job.method -eq 'http' -and (Test-Path $job.tmp)) { $done = (Get-Item $job.tmp).Length }
    return @{
        status  = 'downloading'
        method  = $job.method
        attempt = $job.attempt
        steamcmdReady = (Test-Path (Join-Path $SteamCmdDir 'steamapps'))
        done    = $done
        size    = $job.size
        elapsed = [int]((Get-Date) - $job.started).TotalSeconds
    }
}

function Handle-Addon($ctx, $query) {
    $id = Get-WorkshopId $query['url']
    if (-not $id) { Send-Json $ctx @{ error = 'bad_url' } 400; return }

    $d = (Get-FileDetails @($id))[0]
    if ($d.result -ne 1) { Send-Json $ctx @{ error = 'not_found'; id = $id } 404; return }

    $isCollection = (-not $d.file_url) -and ([int64]$d.file_size -eq 0)
    if ($isCollection) {
        $children = Get-CollectionChildren $id
        if ($children.Count -gt 0) {
            $items = @()
            for ($i = 0; $i -lt $children.Count; $i += 50) {
                $chunk = $children[$i..([Math]::Min($i + 49, $children.Count - 1))]
                $items += Get-FileDetails $chunk | Where-Object { $_.result -eq 1 } | ForEach-Object {
                    @{ id = [string]$_.publishedfileid; title = $_.title; preview = $_.preview_url }
                }
            }
            Send-Json $ctx @{ id = $id; title = $d.title; collection = $true; children = @($items) }
            return
        }
    }

    if ([int]$d.consumer_app_id -ne $GmodAppId) { Send-Json $ctx @{ error = 'not_gmod'; id = $id; title = $d.title } 400; return }

    if (-not (Get-AddonFile $id) -and -not $Jobs[$id]) { Start-Download $d }

    $st = Get-JobStatus $id
    Send-Json $ctx @{
        id = $id; title = $d.title; preview = $d.preview_url
        size = [int64]$d.file_size; status = $st.status; error = $st.error
    }
}

function Handle-Static($ctx, [string]$urlPath) {
    $rel = [Uri]::UnescapeDataString($urlPath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $PublicDir $rel))
    if (-not $full.StartsWith($PublicDir, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes('404')) 'text/plain' 404
        return
    }
    $type = $Mime[[IO.Path]::GetExtension($full).ToLower()]
    if (-not $type) { $type = 'application/octet-stream' }
    Send-File $ctx $full $type
}

function Handle-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $query = $req.QueryString

    switch -Regex ($path) {
        '^/api/addon$'  { Handle-Addon $ctx $query; return }
        '^/api/status$' {
            Send-Json $ctx (Get-JobStatus (Get-WorkshopId $query['id']))
            return
        }
        '^/api/file$' {
            $id = Get-WorkshopId $query['id']
            $f = Get-AddonFile $id
            if (-not $f) { Send-Json $ctx @{ error = 'not_ready' } 404; return }
            try {
                Send-File $ctx $f 'application/octet-stream'
            } finally {
                # l'addon est maintenant dans le navigateur : on ne garde rien
                Remove-Addon $id
            }
            return
        }
        default { Handle-Static $ctx $path }
    }
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Visualisation Skin Gmod lance sur $url" -ForegroundColor Cyan
Write-Host "  (fermez cette fenetre pour arreter le serveur)"
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        try {
            Clear-Stale
            Handle-Request $ctx
        } catch {
            Write-Host "Erreur: $($_.Exception.Message)" -ForegroundColor Red
            try { Send-Json $ctx @{ error = 'server'; message = $_.Exception.Message } 500 } catch { }
        }
    }
} finally {
    $listener.Stop()
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
