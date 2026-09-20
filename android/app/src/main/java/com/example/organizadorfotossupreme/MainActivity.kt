package com.example.organizadorfotossupreme

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.organizadorfotossupreme.theme.OrganizadorFotosSupremeTheme
import kotlinx.coroutines.launch
import java.io.InputStream

class MainActivity : ComponentActivity() {
  private lateinit var db: LocalDatabase
  private lateinit var scanner: LocalMediaScanner
  private lateinit var router: LocalApiRouter
  private lateinit var prefs: SharedPreferences

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    db = LocalDatabase(this)
    scanner = LocalMediaScanner(this, db)
    router = LocalApiRouter(this, db, scanner)
    prefs = getSharedPreferences("fotos_supreme_prefs", Context.MODE_PRIVATE)

    enableEdgeToEdge()
    setContent {
      OrganizadorFotosSupremeTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = MaterialTheme.colorScheme.background
        ) {
          AppMainScreen(db, scanner, router, prefs)
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AppMainScreen(
  db: LocalDatabase,
  scanner: LocalMediaScanner,
  router: LocalApiRouter,
  prefs: SharedPreferences
) {
  var isScanningDevice by remember { mutableStateOf(false) }
  var scanProgress by remember { mutableStateOf("") }
  var webViewRef by remember { mutableStateOf<WebView?>(null) }
  val coroutineScope = rememberCoroutineScope()

  val permissionLauncher = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions()
  ) { permissions ->
    val granted = permissions.values.any { it }
    if (granted) {
      coroutineScope.launch {
        isScanningDevice = true
        scanner.scanDevicePhotos { proc, tot, _ ->
          scanProgress = "$proc / $tot fotos"
        }
        isScanningDevice = false
        webViewRef?.reload()
      }
    }
  }

  fun checkAndStartScan() {
    val permissionsToRequest = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    } else {
      arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    val allGranted = permissionsToRequest.all {
      ContextCompat.checkSelfPermission(webViewRef?.context ?: return, it) == PackageManager.PERMISSION_GRANTED
    }

    if (allGranted) {
      coroutineScope.launch {
        isScanningDevice = true
        scanner.scanDevicePhotos { proc, tot, _ ->
          scanProgress = "$proc / $tot fotos"
        }
        isScanningDevice = false
        webViewRef?.reload()
      }
    } else {
      permissionLauncher.launch(permissionsToRequest)
    }
  }

  LaunchedEffect(Unit) {
    val stats = db.getStats()
    if (stats.optInt("total_photos", 0) == 0) {
      checkAndStartScan()
    }
  }

  BackHandler(enabled = webViewRef?.canGoBack() == true) {
    webViewRef?.goBack()
  }

  Scaffold(
    topBar = {
      TopAppBar(
        title = {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
              modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(Color(0xFF4CAF50))
            )
            Spacer(modifier = Modifier.width(8.dp))
            Column {
              Text(
                "Fotos Supreme",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
              )
              Text(
                if (isScanningDevice) "Escaneando móvil: $scanProgress" else "Móvil Escaneado y Organizado",
                style = MaterialTheme.typography.bodySmall.copy(
                  fontSize = 11.sp,
                  color = if (isScanningDevice) Color(0xFFFFB74D) else Color(0xFF81C784)
                )
              )
            }
          }
        },
        actions = {
          Button(
            onClick = { checkAndStartScan() },
            enabled = !isScanningDevice,
            colors = ButtonDefaults.buttonColors(
              containerColor = MaterialTheme.colorScheme.primaryContainer,
              contentColor = MaterialTheme.colorScheme.onPrimaryContainer
            ),
            modifier = Modifier.padding(end = 6.dp),
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
          ) {
            Text(if (isScanningDevice) "Escaneando..." else "📱 Escanear Móvil", fontSize = 12.sp)
          }

          IconButton(onClick = { webViewRef?.reload() }) {
            Text("🔄", fontSize = 18.sp)
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(
          containerColor = MaterialTheme.colorScheme.surfaceColorAtElevation(3.dp)
        )
      )
    }
  ) { paddingValues ->
    Box(
      modifier = Modifier
        .fillMaxSize()
        .padding(paddingValues)
    ) {
      AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
          WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT,
              ViewGroup.LayoutParams.MATCH_PARENT
            )

            settings.apply {
              javaScriptEnabled = true
              domStorageEnabled = true
              loadWithOverviewMode = true
              useWideViewPort = true
              setSupportZoom(true)
              builtInZoomControls = true
              displayZoomControls = false
              allowFileAccess = true
              allowContentAccess = true
              mediaPlaybackRequiresUserGesture = false
            }

            webViewClient = object : WebViewClient() {
              override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
              ): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null

                if (url.contains("/api/")) {
                  return router.handle(url, request)
                }

                if (url.startsWith("https://app.fotos.supreme/") || url.startsWith("http://localhost/")) {
                  val uri = request.url
                  var path = uri.path ?: "/index.html"
                  if (path == "/" || path.isEmpty()) path = "/index.html"
                  val cleanPath = path.removePrefix("/")

                  val assetPath = "public/$cleanPath"
                  return try {
                    val stream: InputStream = context.assets.open(assetPath)
                    val mime = when {
                      cleanPath.endsWith(".html") -> "text/html"
                      cleanPath.endsWith(".css") -> "text/css"
                      cleanPath.endsWith(".js") -> "application/javascript"
                      cleanPath.endsWith(".png") -> "image/png"
                      cleanPath.endsWith(".ico") -> "image/x-icon"
                      cleanPath.endsWith(".json") -> "application/json"
                      else -> "application/octet-stream"
                    }
                    WebResourceResponse(mime, "utf-8", stream)
                  } catch (e: Exception) {
                    null
                  }
                }

                return super.shouldInterceptRequest(view, request)
              }
            }

            loadUrl("https://app.fotos.supreme/index.html")
            webViewRef = this
          }
        },
        update = { webView ->
          webViewRef = webView
        }
      )

      if (isScanningDevice) {
        LinearProgressIndicator(
          modifier = Modifier
            .fillMaxWidth()
            .align(Alignment.TopCenter)
        )
      }
    }
  }
}
