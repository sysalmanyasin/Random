package com.duapharma.auditwidget

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Holds the logged-in Main Auditor's Supabase session on-device.
 * The widget only ever shows data this session's RLS policies allow it to see.
 */
object TokenStore {

    private const val PREFS_NAME = "audit_widget_secure_prefs"
    private const val KEY_ACCESS_TOKEN = "access_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_EXPIRES_AT = "expires_at_epoch_seconds"
    private const val KEY_AUDITOR_NAME = "auditor_name"
    private const val KEY_USER_ID = "user_id"

    private fun prefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveSession(
        context: Context,
        accessToken: String,
        refreshToken: String,
        expiresAtEpochSeconds: Long,
        userId: String,
        auditorName: String?
    ) {
        prefs(context).edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putLong(KEY_EXPIRES_AT, expiresAtEpochSeconds)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_AUDITOR_NAME, auditorName)
            .apply()
    }

    fun updateAccessToken(context: Context, accessToken: String, expiresAtEpochSeconds: Long) {
        prefs(context).edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putLong(KEY_EXPIRES_AT, expiresAtEpochSeconds)
            .apply()
    }

    fun accessToken(context: Context): String? = prefs(context).getString(KEY_ACCESS_TOKEN, null)
    fun refreshToken(context: Context): String? = prefs(context).getString(KEY_REFRESH_TOKEN, null)
    fun expiresAt(context: Context): Long = prefs(context).getLong(KEY_EXPIRES_AT, 0L)
    fun auditorName(context: Context): String? = prefs(context).getString(KEY_AUDITOR_NAME, null)
    fun isLoggedIn(context: Context): Boolean = !accessToken(context).isNullOrEmpty()

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }
}
