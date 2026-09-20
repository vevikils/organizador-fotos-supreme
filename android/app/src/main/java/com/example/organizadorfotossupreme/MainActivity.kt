package com.example.organizadorfotossupreme

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.organizadorfotossupreme.theme.OrganizadorFotosSupremeTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
  private lateinit var prefs: SharedPreferences
  private val defaultUrl = "http://192.168.68.103:3850"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    prefs = getSharedPreferences("fotos_supreme_prefs", Context.MODE_PRIVATE)

    enableEdgeToEdge()
    setContent {
      OrganizadorFotosSupremeTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = MaterialTheme.colorScheme.background
        ) {
          PhotoAppScreen(prefs, defaultUrl)
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PhotoAppScreen(prefs: SharedPreferences, defaultUrl: String) {
  var serverUrl by remember {
    mutableStateOf(prefs.getString("server_url", defaultUrl) ?: defaultUrl)
  }
  var inputUrl by remember { mutableStateOf(serverUrl) }
  var webViewRef by remember { mutableStateOf<WebView?>(null) }
  var isConnected by remember { mutableStateOf(false) }
  var hasError by remember { mutableStateOf(false) }
  var isLoading by remember { mutableStateOf(true) }
  var progress by remember { mutableStateOf(0) }
  var showSettingsDialog by remember { mutableStateOf(false) }
  val coroutineScope = rememberCoroutineScope()

  fun checkConnection(urlToCheck: String) {
    coroutineScope.launch(Dispatchers.IO) {
      try {
        val target = if (urlToCheck.endsWith("/")) "${urlToCheck}api/server-info" else "$urlToCheck/api/server-info"
        val conn = URL(target).openConnection() as HttpURLConnection
        conn.connectTimeout = 2500
        conn.readTimeout = 2500
        conn.requestMethod = "GET"
        val code = conn.responseCode
        withContext(Dispatchers.Main) {
          isConnected = (code == 200)
        }
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          isConnected = false
        }
      }
    }
  }

  LaunchedEffect(serverUrl) {
    checkConnection(serverUrl)
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
                .background(if (isConnected) Color(0xFF4CAF50) else Color(0xFFFF5252))
            )
            Spacer(modifier = Modifier.width(8.dp))
            Column {
              Text(
                "Fotos Supreme",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
              )
              Text(
                if (isConnected) "PC Conectado" else "Buscando PC...",
                style = MaterialTheme.typography.bodySmall.copy(
                  fontSize = 11.sp,
                  color = if (isConnected) Color(0xFF81C784) else Color(0xFFFF8A80)
                )
              )
            }
          }
        },
        actions = {
          IconButton(onClick = {
            isLoading = true
            hasError = false
            checkConnection(serverUrl)
            webViewRef?.reload()
          }) {
            Text("🔄", fontSize = 18.sp)
          }
          IconButton(onClick = {
            inputUrl = serverUrl
            showSettingsDialog = true
          }) {
            Text("⚙️", fontSize = 18.sp)
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
              databaseEnabled = true
              loadWithOverviewMode = true
              useWideViewPort = true
              setSupportZoom(true)
              builtInZoomControls = true
              displayZoomControls = false
              mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
              cacheMode = WebSettings.LOAD_DEFAULT
              allowFileAccess = true
              allowContentAccess = true
              mediaPlaybackRequiresUserGesture = false
            }

            webChromeClient = object : WebChromeClient() {
              override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress = newProgress
                if (newProgress == 100) {
                  isLoading = false
                }
              }
            }

            webViewClient = object : WebViewClient() {
              override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                isLoading = true
                hasError = false
              }

              override fun onPageFinished(view: WebView?, url: String?) {
                isLoading = false
                checkConnection(serverUrl)
              }

              override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
              ) {
                if (request?.isForMainFrame == true) {
                  isLoading = false
                  hasError = true
                  isConnected = false
                }
              }
            }

            loadUrl(serverUrl)
            webViewRef = this
          }
        },
        update = { webView ->
          webViewRef = webView
        }
      )

      if (isLoading && progress < 100) {
        LinearProgressIndicator(
          progress = { progress / 100f },
          modifier = Modifier
            .fillMaxWidth()
            .align(Alignment.TopCenter)
        )
      }

      if (hasError) {
        Card(
          modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp)
            .align(Alignment.Center),
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
          )
        ) {
          Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
          ) {
            Text("⚠️", fontSize = 48.sp)
            Spacer(modifier = Modifier.height(16.dp))
            Text(
              "No se puede conectar a tu PC",
              style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
              textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
              "Asegúrate de que 'Organizador Supremo de Fotos' esté abierto en tu ordenador y que ambos dispositivos estén conectados al mismo Wi-Fi.",
              style = MaterialTheme.typography.bodyMedium,
              textAlign = TextAlign.Center,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(12.dp))
            Surface(
              color = MaterialTheme.colorScheme.surface,
              shape = RoundedCornerShape(8.dp)
            ) {
              Text(
                text = serverUrl,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                style = MaterialTheme.typography.labelMedium
              )
            }
            Spacer(modifier = Modifier.height(20.dp))
            Row(
              modifier = Modifier.fillMaxWidth(),
              horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
              OutlinedButton(
                onClick = {
                  inputUrl = serverUrl
                  showSettingsDialog = true
                },
                modifier = Modifier.weight(1f)
              ) {
                Text("Cambiar IP")
              }
              Button(
                onClick = {
                  hasError = false
                  isLoading = true
                  checkConnection(serverUrl)
                  webViewRef?.loadUrl(serverUrl)
                },
                modifier = Modifier.weight(1f)
              ) {
                Text("Reintentar")
              }
            }
          }
        }
      }
    }
  }

  if (showSettingsDialog) {
    AlertDialog(
      onDismissRequest = { showSettingsDialog = false },
      title = { Text("Conectar con el Servidor PC") },
      text = {
        Column {
          Text(
            "Introduce la dirección IP de tu ordenador donde se ejecuta Organizador Supremo de Fotos:",
            style = MaterialTheme.typography.bodyMedium
          )
          Spacer(modifier = Modifier.height(12.dp))
          OutlinedTextField(
            value = inputUrl,
            onValueChange = { inputUrl = it },
            label = { Text("URL del Servidor") },
            placeholder = { Text("http://192.168.1.100:3850") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
          )
          Spacer(modifier = Modifier.height(8.dp))
          Text(
            "Tip: La IP predeterminada de tu PC es 192.168.68.103 en el puerto 3850.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
        }
      },
      confirmButton = {
        Button(
          onClick = {
            var raw = inputUrl.trim()
            if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
              raw = "http://$raw"
            }
            val cleanHost = raw.removePrefix("http://").removePrefix("https://").trimEnd('/')
            val formatted = if (':' !in cleanHost) {
              "http://$cleanHost:3850"
            } else {
              raw
            }
            serverUrl = formatted
            prefs.edit().putString("server_url", formatted).apply()
            showSettingsDialog = false
            hasError = false
            isLoading = true
            webViewRef?.loadUrl(formatted)
            checkConnection(formatted)
          }
        ) {
          Text("Conectar")
        }
      },
      dismissButton = {
        TextButton(onClick = { showSettingsDialog = false }) {
          Text("Cancelar")
        }
      }
    )
  }
}
