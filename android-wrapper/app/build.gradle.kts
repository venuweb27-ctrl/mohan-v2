import java.net.URI
import java.util.Properties
plugins { id("com.android.application") }

val appUrl: String = (project.findProperty("appUrl") as String?) ?: "https://mohanmishra-v2.onrender.com/"
val ksFile = rootProject.file("keystore.properties")

android {
    namespace = "in.mohanmishra.app"
    compileSdk = 34
    defaultConfig {
        applicationId = "in.mohanmishra.app"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
        resValue("string", "app_host", URI(appUrl).host)
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        if (ksFile.exists()) create("release") {
            val p = Properties().apply { ksFile.inputStream().use { load(it) } }
            storeFile = rootProject.file(p.getProperty("storeFile")); storePassword = p.getProperty("storePassword")
            keyAlias = p.getProperty("keyAlias"); keyPassword = p.getProperty("keyPassword")
        }
    }
    buildTypes {
        release { isMinifyEnabled = false; if (ksFile.exists()) signingConfig = signingConfigs.getByName("release") }
        debug { versionNameSuffix = "-debug" }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
