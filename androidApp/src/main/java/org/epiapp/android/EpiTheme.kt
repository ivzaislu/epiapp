package org.epiapp.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// A calm, consistent medical-app palette shared by child and parent modes.
object EpiColors {
    val ocean = Color(0xFF246A70)
    val oceanSoft = Color(0xFFE6F3F1)
    val ink = Color(0xFF1C343A)
    val muted = Color(0xFF64777A)
    val background = Color(0xFFF5F8F6)
    val success = Color(0xFF276F54)
    val successSoft = Color(0xFFE4F2E8)
}

private val epiLight = lightColorScheme(
    primary = EpiColors.ocean,
    onPrimary = Color.White,
    primaryContainer = EpiColors.oceanSoft,
    onPrimaryContainer = Color(0xFF164F53),
    secondary = Color(0xFF537A79),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE8F0EB),
    onSecondaryContainer = EpiColors.ink,
    tertiary = EpiColors.success,
    onTertiary = Color.White,
    tertiaryContainer = EpiColors.successSoft,
    onTertiaryContainer = Color(0xFF17533D),
    background = EpiColors.background,
    onBackground = EpiColors.ink,
    surface = Color.White,
    onSurface = EpiColors.ink,
    surfaceVariant = Color(0xFFEAF0ED),
    onSurfaceVariant = EpiColors.muted,
    outline = Color(0xFFA7B8B2),
    error = Color(0xFFB74642),
)

private val epiDark = darkColorScheme(
    primary = Color(0xFF8BCDC8),
    onPrimary = Color(0xFF143D40),
    primaryContainer = Color(0xFF244C50),
    onPrimaryContainer = Color(0xFFCBEEEB),
    secondary = Color(0xFFAAC8C2),
    onSecondary = Color(0xFF233D3D),
    secondaryContainer = Color(0xFF314A49),
    onSecondaryContainer = Color(0xFFD5E6E2),
    tertiary = Color(0xFF9CD8B6),
    onTertiary = Color(0xFF153F2A),
    tertiaryContainer = Color(0xFF244C38),
    onTertiaryContainer = Color(0xFFCEF4DB),
    background = Color(0xFF122124),
    onBackground = Color(0xFFE5F0ED),
    surface = Color(0xFF1B3033),
    onSurface = Color(0xFFE5F0ED),
    surfaceVariant = Color(0xFF2A4243),
    onSurfaceVariant = Color(0xFFBCD0CA),
    outline = Color(0xFF77938C),
    error = Color(0xFFFFB6AE),
)

@Composable
fun EpiTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) epiDark else epiLight, content = content)
}
