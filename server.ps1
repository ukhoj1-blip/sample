# Static file server (no Python/Node needed). Kakao Maps does not work from file://, so serve over localhost.
param([int]$Port = 8080)

$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Card home-proximity analyzer: http://localhost:$Port  (stop: Ctrl+C)"

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Fallback relay to the NTS business status API (data.go.kr), used when a network blocks the browser's direct call.
function Invoke-NtsStatus([string]$query, [string]$body) {
  $wr = [Net.HttpWebRequest]::Create("https://api.odcloud.kr/api/nts-businessman/v1/status$query")
  $wr.Method = 'POST'
  $wr.ContentType = 'application/json'
  $wr.Accept = 'application/json'
  $wr.Timeout = 20000
  $b = [Text.Encoding]::UTF8.GetBytes($body)
  $wr.ContentLength = $b.Length
  try {
    $s = $wr.GetRequestStream(); $s.Write($b, 0, $b.Length); $s.Close()
    $resp = $wr.GetResponse()
  } catch [Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ code = 502; bytes = [Text.Encoding]::UTF8.GetBytes('{"msg":"proxy: cannot reach api.odcloud.kr"}') } }
  }
  $ms = New-Object IO.MemoryStream
  $resp.GetResponseStream().CopyTo($ms)
  $code = [int]$resp.StatusCode
  $resp.Close()
  return @{ code = $code; bytes = $ms.ToArray() }
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      if ($ctx.Request.Url.AbsolutePath -eq '/api/nts-status' -and $ctx.Request.HttpMethod -eq 'POST') {
        $body = (New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
        $r = Invoke-NtsStatus $ctx.Request.Url.Query $body
        $res.StatusCode = $r.code
        $res.ContentType = 'application/json; charset=utf-8'
        $res.OutputStream.Write($r.bytes, 0, $r.bytes.Length)
        continue
      }
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($rel -eq '') { $rel = 'index.html' }
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $path -PathType Leaf)) {
        $res.StatusCode = 404
      } else {
        $bytes = [IO.File]::ReadAllBytes($path)
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
