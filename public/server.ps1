$port = 6767
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Listening on port $port..."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        
        $filePath = Join-Path (Get-Location) $path
        
        if (Test-Path $filePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $content.Length
            
            # Simple content types
            if ($filePath -match "\.html$") { $response.ContentType = "text/html" }
            elseif ($filePath -match "\.css$") { $response.ContentType = "text/css" }
            elseif ($filePath -match "\.js$") { $response.ContentType = "application/javascript" }
            elseif ($filePath -match "\.png$") { $response.ContentType = "image/png" }
            elseif ($filePath -match "\.jpg$") { $response.ContentType = "image/jpeg" }
            
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
