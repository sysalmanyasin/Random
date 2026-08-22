package com.duapharma.auditwidget

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks directly to Supabase Auth's REST endpoints (no SDK dependency needed).
 * Mirrors the phone -> "<digits>@staff.internal" mapping used by the main PWA.
 */
object SupabaseAuth {

    class AuthException(message: String) : Exception(message)

    data class Session(
        val accessToken: String,
        val refreshToken: String,
        val expiresAtEpochSeconds: Long,
        val userId: String
    )

    /** Logs in with phone + PIN, exactly like the web app's staff login. */
    fun login(phone: String, pin: String): Session {
        val digits = phone.filter { it.isDigit() }
        if (digits.isEmpty()) throw AuthException("Enter a valid phone number")
        val email = "$digits@staff.internal"

        val url = URL("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=password")
        val body = JSONObject().apply {
            put("email", email)
            put("password", pin)
        }
        val json = postJson(url, body)
        return sessionFromAuthResponse(json)
    }

    /** Exchanges a refresh token for a new access token when the current one has expired. */
    fun refresh(refreshToken: String): Session {
        val url = URL("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token")
        val body = JSONObject().apply {
            put("refresh_token", refreshToken)
        }
        val json = postJson(url, body)
        return sessionFromAuthResponse(json)
    }

    private fun sessionFromAuthResponse(json: JSONObject): Session {
        if (json.has("error") || json.has("error_description")) {
            throw AuthException(json.optString("error_description", json.optString("error", "Login failed")))
        }
        val accessToken = json.optString("access_token", "")
        val refreshToken = json.optString("refresh_token", "")
        val expiresIn = json.optLong("expires_in", 3600L)
        if (accessToken.isEmpty() || refreshToken.isEmpty()) {
            throw AuthException("Unexpected response from server")
        }
        val userId = json.optJSONObject("user")?.optString("id").orEmpty()
        val expiresAt = (System.currentTimeMillis() / 1000L) + expiresIn - 30 // 30s safety margin
        return Session(accessToken, refreshToken, expiresAt, userId)
    }

    private fun postJson(url: URL, body: JSONObject): JSONObject {
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }

            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            val text = BufferedReader(InputStreamReader(stream)).use { it.readText() }
            return JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
