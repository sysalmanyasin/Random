package com.duapharma.auditwidget

import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import android.widget.RemoteViewsService

private const val TAG = "AuditWidget"

class WidgetRemoteViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        RoundsRemoteViewsFactory(applicationContext)
}

class RoundsRemoteViewsFactory(private val context: android.content.Context) :
    RemoteViewsService.RemoteViewsFactory {

    private var rows: List<RoundRow> = emptyList()

    override fun onCreate() {}

    // Called by the system on a background thread — safe to do blocking network I/O here.
    // Must never throw: an uncaught exception here leaves the widget stuck on the
    // system's default "Loading..." placeholder rows indefinitely.
    override fun onDataSetChanged() {
        rows = try {
            when (val result = RoundsRepository.fetchOpenIndividualRounds(context)) {
                is RoundsResult.Success -> {
                    Log.i(TAG, "Fetched ${result.rows.size} open individual-assignment rows")
                    result.rows
                }
                is RoundsResult.NotLoggedIn -> {
                    Log.i(TAG, "onDataSetChanged: not logged in")
                    emptyList()
                }
                is RoundsResult.Error -> {
                    Log.e(TAG, "onDataSetChanged fetch error: ${result.message}")
                    emptyList()
                }
            }
        } catch (t: Throwable) {
            // Belt-and-braces: RoundsRepository already catches Exception internally,
            // but catch Throwable here too so nothing (OOM, linkage errors, etc.) can
            // escape and leave the widget stuck showing the loading stub forever.
            Log.e(TAG, "onDataSetChanged crashed", t)
            emptyList()
        }
    }

    override fun onDestroy() {
        rows = emptyList()
    }

    override fun getCount(): Int = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val row = rows[position]
        val views = RemoteViews(context.packageName, R.layout.widget_row_item)

        views.setTextViewText(
            R.id.rowTitle,
            "R${row.roundNumber} · ${row.engagementName} · ${row.auditorName}"
        )

        val progressText = if (row.totalItems > 0) {
            "${row.progressCount}/${row.totalItems} items · ${row.assignmentStatus}"
        } else {
            row.assignmentStatus
        }
        views.setTextViewText(R.id.rowSubtitle, progressText)

        views.setTextViewText(R.id.rowState, row.state)
        views.setInt(R.id.rowState, "setBackgroundResource", badgeDrawableFor(row.state))

        return views
    }

    private fun badgeDrawableFor(state: String): Int = when (state) {
        "draft" -> R.drawable.badge_draft
        "locked" -> R.drawable.badge_locked
        "counting" -> R.drawable.badge_counting
        "compiled" -> R.drawable.badge_compiled
        "final" -> R.drawable.badge_final
        else -> R.drawable.badge_pill
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
}
