import java.net.URI
import java.util.Properties
plugins { id("com.android.application") }

// ── Single places to change things (gradle.properties or -P flags) ──
// appUrl       : site the app opens (switch to the custom domain here, then rebuild)
// appVersionCode / appVersionName : Play Store version (versionCode must always increase)
fun prop(name: String, def: String): String = (project.findProperty(name) as String?) ?: def
val appUrl: String = prop("appUrl", "https://store.mohanmishra.app/")
val vCode: Int = prop("appVersionCode", "100").toInt()
val vName: String = prop("appVersionName", "2.0.0")

// Release signing comes ONLY from env vars / Gradle properties (never committed):
//   MM_KEYSTORE (path), MM_KEY_ALIAS, MM_STORE_PASSWORD, MM_KEY_PASSWORD
// or legacy keystore.properties next to the project (git-ignored).
fun secret(n: String): String? = System.getenv(n) ?: (project.findProperty(n) as String?)
val ksFile = rootProject.file("keystore.properties")

android {
    namespace = "com.app.mmpl"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.app.mmpl"
        minSdk = 24
        targetSdk = 35
        versionCode = vCode
        versionName = vName
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
        resValue("string", "app_host", URI(appUrl).host)
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        create("release") {
            val envKs = secret("MM_KEYSTORE")
            if (envKs != null) {
                storeFile = file(envKs); storePassword = secret("MM_STORE_PASSWORD")
                keyAlias = secret("MM_KEY_ALIAS") ?: "upload"; keyPassword = secret("MM_KEY_PASSWORD") ?: secret("MM_STORE_PASSWORD")
            } else if (ksFile.exists()) {
                val p = Properties().apply { ksFile.inputStream().use { load(it) } }
                storeFile = rootProject.file(p.getProperty("storeFile")); storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias"); keyPassword = p.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false; isShrinkResources = false   // WebView shell: tiny already; no reflection risk
            val sc = signingConfigs.getByName("release"); if (sc.storeFile != null) signingConfig = sc
        }
        debug { versionNameSuffix = "-debug"; applicationIdSuffix = ".debug" }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
