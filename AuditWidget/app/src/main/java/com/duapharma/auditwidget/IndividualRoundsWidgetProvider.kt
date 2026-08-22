package com.duapharma.auditwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class IndividualRoundsWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.auditwidget.ACTION_REFRESH"
        private const val WORK_NAME = "individual_rounds_periodic_refresh"

        fun refreshAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, IndividualRoundsWidgetProvider::class.java))
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.roundsList)
        }

        fun schedulePeriodicRefresh(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_rounds)

            val adapterIntent = Intent(context, WidgetRemoteViewsService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                data = android.net.Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.roundsList, adapterIntent)
            views.setEmptyView(R.id.roundsList, R.id.emptyText)
            views.setTextViewText(
                R.id.emptyText,
                if (TokenStore.isLoggedIn(context)) context.getString(R.string.empty_state)
                else context.getString(R.string.not_logged_in)
            )

            val refreshIntent = Intent(context, IndividualRoundsWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            }
            val refreshPendingIntent = android.app.PendingIntent.getBroadcast(
                context, id, refreshIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.refreshButton, refreshPendingIntent)

            // Tapping a row (or the widget with no rows) opens the login/status screen.
            val openAppIntent = Intent(context, LoginActivity::class.java)
            val openAppPendingIntent = android.app.PendingIntent.getActivity(
                context, 0, openAppIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            views.setPendingIntentTemplate(R.id.roundsList, openAppPendingIntent)
            views.setOnClickPendingIntent(R.id.widgetTitle, openAppPendingIntent)

            appWidgetManager.updateAppWidget(id, views)
        }
        schedulePeriodicRefresh(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            refreshAll(context)
        }
    }

    override fun onEnabled(context: Context) {
        schedulePeriodicRefresh(context)
    }
}
