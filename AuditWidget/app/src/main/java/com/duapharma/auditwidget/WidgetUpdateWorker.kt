package com.duapharma.auditwidget

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Triggers a fresh fetch on the home-screen widget's list (RemoteViewsFactory.onDataSetChanged
 * does the actual Supabase call). Runs every ~15 minutes while the widget is on a home screen.
 */
class WidgetUpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        return try {
            IndividualRoundsWidgetProvider.refreshAll(applicationContext)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
