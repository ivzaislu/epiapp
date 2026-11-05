package org.epiapp.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Shared EpiApp design tokens: blue, white and subtle blue surfaces.
 * Green is only used as a semantic "dose recorded" indicator.
 * Type sizes are phone-sized so titles, times and captions stay in one scale.
 */
object EpiColors {
    val primary = Color(0xFF2F6BFF)
    val primaryStrong = Color(0xFF1F4FCC)
    val primarySoft = Color(0xFFEEF4FF)
    val white = Color(0xFFFFFFFF)
    val background = Color(0xFFF8FAFF)
    val text = Color(0xFF1E2A3A)
    val muted = Color(0xFF62728A)
    val success = Color(0xFF237653)
    val successSoft = Color(0xFFE6F5ED)
}

private val epiLight = lightColorScheme(
    primary = EpiColors.primary,
    onPrimary = EpiColors.white,
    primaryContainer = EpiColors.primarySoft,
    onPrimaryContainer = EpiColors.primaryStrong,
    secondary = EpiColors.primaryStrong,
    onSecondary = EpiColors.white,
    secondaryContainer = Color(0xFFDDE9FF),
    onSecondaryContainer = EpiColors.text,
    tertiary = EpiColors.success,
    onTertiary = EpiColors.white,
    tertiaryContainer = EpiColors.successSoft,
    onTertiaryContainer = Color(0xFF19523C),
    background = EpiColors.background,
    onBackground = EpiColors.text,
    surface = EpiColors.white,
    onSurface = EpiColors.text,
    surfaceVariant = EpiColors.primarySoft,
    onSurfaceVariant = EpiColors.muted,
    outline = Color(0xFFB6C4DB),
    error = Color(0xFFB42337),
)

private val epiDark = darkColorScheme(
    primary = Color(0xFFA9C5FF),
    onPrimary = Color(0xFF102E79),
    primaryContainer = Color(0xFF193B88),
    onPrimaryContainer = Color(0xFFE7F0FF),
    secondary = Color(0xFFB8CCFF),
    onSecondary = Color(0xFF1C3262),
    secondaryContainer = Color(0xFF263B67),
    onSecondaryContainer = Color(0xFFE5ECFA),
    tertiary = Color(0xFF98DAB7),
    onTertiary = Color(0xFF153B29),
    tertiaryContainer = Color(0xFF204935),
    onTertiaryContainer = Color(0xFFC6F6D9),
    background = Color(0xFF101827),
    onBackground = Color(0xFFEEF3FF),
    surface = Color(0xFF1A2539),
    onSurface = Color(0xFFEEF3FF),
    surfaceVariant = Color(0xFF283650),
    onSurfaceVariant = Color(0xFFC1D0E8),
    outline = Color(0xFF7688A6),
    error = Color(0xFFFFB4BF),
)

private val epiType = Typography(
    headlineMedium = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 23.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
)

private val epiShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
)

@Composable
fun EpiTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) epiDark else epiLight,
        typography = epiType,
        shapes = epiShapes,
        content = content,
    )
}
