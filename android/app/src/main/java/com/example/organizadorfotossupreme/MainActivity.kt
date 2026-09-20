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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
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
  var totalPhotosCount by remember { mutableIntStateOf(0) }
  var webViewRef by remember { mutableStateOf<WebView?>(null) }
  val coroutineScope = rememberCoroutineScope()

  fun refreshStats() {
    val stats = db.getStats()
    totalPhotosCount = stats.optInt("total_photos", 0)
  }

  val permissionLauncher = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions()
  ) { permissions ->
    val granted = permissions.values.any { it }
    if (granted) {
      coroutineScope.launch {
        isScanningDevice = true
        scanner.scanDevicePhotos { proc, tot, _ ->
          scanProgress = "$proc / $tot"
        }
        isScanningDevice = false
        refreshStats()
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
          scanProgress = "$proc / $tot"
        }
        isScanningDevice = false
        refreshStats()
        webViewRef?.reload()
      }
    } else {
      permissionLauncher.launch(permissionsToRequest)
    }
  }

  LaunchedEffect(Unit) {
    refreshStats()
    if (totalPhotosCount == 0) {
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
            Image(
              painter = painterResource(id = R.drawable.app_logo),
              contentDescription = "Logo Fotos Supreme",
              modifier = Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(8.dp))
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column {
              Text(
                "Fotos Supreme",
                style = MaterialTheme.typography.titleMedium.copy(
                  fontWeight = FontWeight.Bold,
                  fontSize = 16.sp
                )
              )
              Text(
                if (isScanningDevice) "Escaneando: $scanProgress fotos"
                else if (totalPhotosCount > 0) "$totalPhotosCount fotos organizadas"
                else "Móvil listo para escanear",
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
            modifier = Modifier.padding(end = 4.dp),
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
          ) {
            Text(
              if (isScanningDevice) "Escaneando..." else "📱 Escanear",
              fontSize = 12.sp,
              fontWeight = FontWeight.SemiBold
            )
          }

          IconButton(
            onClick = {
              refreshStats()
              webViewRef?.reload()
            },
            modifier = Modifier.size(36.dp)
          ) {
            Text("🔄", fontSize = 16.sp)
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(
          containerColor = MaterialTheme.colorScheme.surfaceColorAtElevation(2.dp)
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
              setSupportZoom(false)
              builtInZoomControls = false
              displayZoomControls = false
              allowFileAccess = true
              allowContentAccess = true
              mediaPlaybackRequiresUserGesture = false
              textZoom = 100
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
