package org.epiapp.android

import android.content.Context
import org.json.JSONObject

data class NativeSchedule(
    val childName: String,
    val medicationName: String,
    val morningDose: String,
    val eveningDose: String,
    val morningTime: String,
    val eveningTime: String,
    val timezone: String,
    val remindersEnabled: Boolean,
    val reminderFirstMinutes: Int,
    val reminderUrgentMinutes: Int,
    val reminderRepeatMinutes: Int,
    val reminderStopMinutes: Int,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("childName", childName)
        put("medicationName", medicationName)
        put("morningDose", morningDose)
        put("eveningDose", eveningDose)
        put("morningTime", morningTime)
        put("eveningTime", eveningTime)
        put("timezone", timezone)
        put("remindersEnabled", remindersEnabled)
        put("reminderFirstMinutes", reminderFirstMinutes)
        put("reminderUrgentMinutes", reminderUrgentMinutes)
        put("reminderRepeatMinutes", reminderRepeatMinutes)
        put("reminderStopMinutes", reminderStopMinutes)
    }

    companion object {
        fun fromJson(json: JSONObject): NativeSchedule = NativeSchedule(
            childName = json.optString("childName", "Ребёнок"),
            medicationName = json.optString("medicationName", ""),
            morningDose = json.optString("morningDose", ""),
            eveningDose = json.optString("eveningDose", ""),
            morningTime = json.optString("morningTime", "08:00"),
            eveningTime = json.optString("eveningTime", "20:00"),
            timezone = json.optString("timezone", "Europe/Berlin"),
            remindersEnabled = json.optBoolean("remindersEnabled", true),
            reminderFirstMinutes = json.optInt("reminderFirstMinutes", 15),
            reminderUrgentMinutes = json.optInt("reminderUrgentMinutes", 30),
            reminderRepeatMinutes = json.optInt("reminderRepeatMinutes", 15),
            reminderStopMinutes = json.optInt("reminderStopMinutes", 60),
        )
    }
}

data class DeviceSession(
    val role: String,
    val cookie: String?,
    val deviceToken: String? = null,
)

data class DeviceScheduleState(
    val role: String,
    val schedule: NativeSchedule,
    val today: String,
    val morningTaken: Boolean,
    val eveningTaken: Boolean,
)

data class RecentDose(
    val id: String,
    val slot: String,
    val localDate: String,
    val localTime: String,
) {
    companion object {
        fun fromJson(json: JSONObject, timezone: String): RecentDose {
            val takenAt = json.optString("takenAt", "")
            val localTime = try {
                val zone = java.time.ZoneId.of(timezone)
                java.time.Instant.parse(takenAt).atZone(zone).format(
                    java.time.format.DateTimeFormatter.ofPattern("HH:mm"),
                )
            } catch (_: Exception) {
                "—"
            }
            return RecentDose(
                id = json.optString("id", takenAt + ":" + json.optString("slot")),
                slot = json.optString("slot"),
                localDate = json.optString("localDate"),
                localTime = localTime,
            )
        }
    }
}

data class ParentStats(
    val requestedDays: Int,
    val expected: Int,
    val taken: Int,
    val missed: Int,
    val rate: Int?,
    val currentStreak: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): ParentStats = ParentStats(
            requestedDays = json.optInt("requestedDays", 7),
            expected = json.optInt("expected", 0),
            taken = json.optInt("taken", 0),
            missed = json.optInt("missed", 0),
            rate = if (json.isNull("rate") || !json.has("rate")) null else json.optInt("rate"),
            currentStreak = json.optInt("currentStreak", 0),
        )
    }
}

object ScheduleStore {
    private const val PREFS = "epiapp_schedule"
    private const val KEY_SCHEDULE = "schedule_json"
    private const val KEY_ROLE = "role"

    fun save(context: Context, role: String, schedule: NativeSchedule) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_ROLE, role)
            .putString(KEY_SCHEDULE, schedule.toJson().toString())
            .apply()
    }

    fun load(context: Context): Pair<String, NativeSchedule>? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_SCHEDULE, null) ?: return null
        val role = prefs.getString(KEY_ROLE, null) ?: return null
        return try {
            role to NativeSchedule.fromJson(JSONObject(raw))
        } catch (_: Exception) {
            null
        }
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }
}
