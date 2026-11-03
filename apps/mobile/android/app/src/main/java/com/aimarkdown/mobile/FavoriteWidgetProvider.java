package com.aimarkdown.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** One-tap home-screen card that launches AiMD with the favourite capture dialog open. */
public class FavoriteWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(MainActivity.ACTION_OPEN_FAVORITE);
        intent.putExtra(MainActivity.EXTRA_OPEN_FAVORITE, true);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            501,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.favorite_widget);
            views.setOnClickPendingIntent(R.id.favorite_widget_root, pending);
            manager.updateAppWidget(id, views);
        }
    }
}
