package com.duapharma.auditwidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

data class RoundRow(
    val engagementName: String,
    val roundNumber: Int,
    val unit: String,
    val state: String,          // draft | locked | counting | compiled | final
    val auditorName: String,
    val assignmentStatus: String, // assigned | counting | submitted | revoked
    val progressCount: Int,
    val totalItems: Int
)

sealed class RoundsResult {
    data class Success(val rows: List<RoundRow>) : RoundsResult()
    object NotLoggedIn : RoundsResult()
    data class Error(val message: String) : RoundsResult()
}

/**
 * Reads only what the logged-in Main Auditor's session is allowed to see (RLS-enforced
 * server-side). Queries: open individual engagements -> their rounds -> assignments per round.
 */
object RoundsRepository {

    fun fetchOpenIndividualRounds(context: Context): RoundsResult {
        if (!TokenStore.isLoggedIn(context)) return RoundsResult.NotLoggedIn

        return try {
            val token = validAccessToken(context) ?: return RoundsResult.NotLoggedIn

            val engagements = restGet(
                token,
                "engagements",
                "select=id,name&scope_type=eq.individual&status=eq.open"
            ) ?: return RoundsResult.NotLoggedIn // token invalid even after refresh

            if (engagements.length() == 0) return RoundsResult.Success(emptyList())

            val engagementIds = mutableListOf<String>()
            val engagementNames = mutableMapOf<String, String>()
            for (i in 0 until engagements.length()) {
                val e = engagements.getJSONObject(i)
                val id = e.getString("id")
                engagementIds.add(id)
                engagementNames[id] = e.optString("name", "Engagement")
            }

            val roundsArr = restGet(
                token,
                "rounds",
                "select=id,engagement_id,round_number,unit,state&engagement_id=in.(${engagementIds.joinToString(",")})&order=round_number.asc"
            ) ?: JSONArray()

            if (roundsArr.length() == 0) return RoundsResult.Success(emptyList())

            val roundIds = mutableListOf<String>()
            val roundMeta = mutableMapOf<String, Triple<String, Int, Pair<String, String>>>()
            // roundId -> (engagementName, roundNumber, Pair(unit, state))
            for (i in 0 until roundsArr.length()) {
                val r = roundsArr.getJSONObject(i)
                val id = r.getString("id")
                val engId = r.getString("engagement_id")
                roundIds.add(id)
                roundMeta[id] = Triple(
                    engagementNames[engId] ?: "Engagement",
                    r.optInt("round_number", 0),
                    Pair(r.optString("unit", ""), r.optString("state", "draft"))
                )
            }

            val assignmentsArr = restGet(
                token,
                "assignments",
                "select=round_id,auditor_name,status,progress_count,items&round_id=in.(${roundIds.joinToString(",")})"
            ) ?: JSONArray()

            val rows = mutableListOf<RoundRow>()
            for (i in 0 until assignmentsArr.length()) {
                val a = assignmentsArr.getJSONObject(i)
                val roundId = a.getString("round_id")
                val meta = roundMeta[roundId] ?: continue
                val itemsArr = a.optJSONArray("items")
                rows.add(
                    RoundRow(
                        engagementName = meta.first,
                        roundNumber = meta.second,
                        unit = meta.third.first,
                        state = meta.third.second,
                        auditorName = a.optString("auditor_name", "Unassigned"),
                        assignmentStatus = a.optString("status", "assigned"),
                        progressCount = a.optInt("progress_count", 0),
                        totalItems = itemsArr?.length() ?: 0
                    )
                )
            }

            rows.sortWith(compareBy({ it.roundNumber }, { it.auditorName }))
            RoundsResult.Success(rows)
        } catch (e: Exception) {
            RoundsResult.Error(e.message ?: "Failed to load rounds")
        }
    }

    /** Returns a currently-valid access token, refreshing it first if it has expired. */
    private fun validAccessToken(context: Context): String? {
        val nowSeconds = System.currentTimeMillis() / 1000L
        val expiresAt = TokenStore.expiresAt(context)
        val current = TokenStore.accessToken(context) ?: return null

        if (nowSeconds < expiresAt) return current

        val refreshToken = TokenStore.refreshToken(context) ?: return null
        return try {
            val session = SupabaseAuth.refresh(refreshToken)
            TokenStore.updateAccessToken(context, session.accessToken, session.expiresAtEpochSeconds)
            session.accessToken
        } catch (e: Exception) {
            null // refresh token itself expired/revoked -> caller treats as logged out
        }
    }

    /** Simple PostgREST GET. Returns null (caller treats as auth failure) on 401/403. */
    private fun restGet(accessToken: String, table: String, query: String): JSONArray? {
        val url = URL("${BuildConfig.SUPABASE_URL}/rest/v1/$table?$query")
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode == 401 || conn.responseCode == 403) return null
            if (conn.responseCode !in 200..299) {
                val err = conn.errorStream?.let { BufferedReader(InputStreamReader(it)).use { r -> r.readText() } }
                throw RuntimeException("Supabase error ${conn.responseCode}: ${err ?: ""}")
            }
            val text = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
            return JSONArray(text)
        } finally {
            conn.disconnect()
        }
    }
}
