package com.duapharma.auditwidget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

class WidgetRemoteViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        RoundsRemoteViewsFactory(applicationContext)
}

class RoundsRemoteViewsFactory(private val context: android.content.Context) :
    RemoteViewsService.RemoteViewsFactory {

    private var rows: List<RoundRow> = emptyList()

    override fun onCreate() {}

    // Called by the system on a background thread — safe to do blocking network I/O here.
    override fun onDataSetChanged() {
        rows = when (val result = RoundsRepository.fetchOpenIndividualRounds(context)) {
            is RoundsResult.Success -> result.rows
            else -> emptyList()
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
