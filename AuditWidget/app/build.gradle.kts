plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.duapharma.auditwidget"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.duapharma.auditwidget"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // Public anon/publishable key — safe to bake in, same as the PWA does.
        // Override at build time with -PsupabaseUrl=... -PsupabaseAnonKey=... if needed.
        // .toString().ifBlank so an *empty-but-set* Gradle property (e.g. an unset GitHub
        // Actions secret, which arrives as "" rather than unset) doesn't silently clobber
        // the default the way `?: default` would.
        val supabaseUrl = (project.findProperty("supabaseUrl") as String?).orEmpty()
            .ifBlank { "https://vtcrdkqhuvxatclobsby.supabase.co" }
        val supabaseAnonKey = (project.findProperty("supabaseAnonKey") as String?).orEmpty()
            .ifBlank { "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Y3Jka3FodXZ4YXRjbG9ic2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTcxMTksImV4cCI6MjA5ODc5MzExOX0.heqbikHbfHQ-kWZVOXxJZvQP5ENc8UXyF4Vb5FNOgpU" }

        buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
