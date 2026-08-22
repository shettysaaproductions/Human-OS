import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { chatCompletionBackground } from '../lib/nvidia';
import axios from 'axios';

// Interface for Open-Meteo Geocoding
interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export class WeatherWatcherService {
  // NOTE: In-memory cooldown removed — it resets on every Render restart (free tier).
  // Cooldown is now 100% DB-backed via nova_outreach_log (outreach_type = 'proactive_weather').
  // This means the 12-hour dedup survives server restarts.

  /**
   * Fetches the current weather for a user's location and evaluates if an alert is needed.
   * Runs as a background CRON job (e.g., every 3-4 hours).
   */
  async checkWeatherForUser(userId: string): Promise<void> {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('country').eq('id', userId).maybeSingle();
      const location = profile?.country || 'India'; // Defaulting for now; in a real app, we'd have exact city

      // 1. Geocode the location using Open-Meteo Free Geocoding API
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geoResponse = await axios.get(geoUrl);
      const results = geoResponse.data.results;
      
      if (!results || results.length === 0) return;
      const { latitude, longitude } = results[0] as GeocodeResult;

      // 2. Fetch Current Weather using Open-Meteo Free Weather API
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
      const weatherResponse = await axios.get(weatherUrl);
      const current = weatherResponse.data.current_weather;

      if (!current) return;

      const temp = current.temperature;
      const windSpeed = current.windspeed;
      const weatherCode = current.weathercode;
      // Weather code mappings (WMO): 61,63,65: Rain, 71,73,75: Snow, 95,96,99: Thunderstorm

      // Is it a severe/notable weather event?
      const isRaining = [61, 63, 65, 80, 81, 82].includes(weatherCode);
      const isThunderstorm = [95, 96, 99].includes(weatherCode);
      const isExtremeHeat = temp >= 40;
      const isExtremeCold = temp <= 5;

      if (!isRaining && !isThunderstorm && !isExtremeHeat && !isExtremeCold) {
        // Normal weather, don't spam the user
        return;
      }

      // ── DB-BACKED 12-HOUR COOLDOWN (survives server restarts) ───────────────
      // Check if we already sent a weather alert in the last 12 hours.
      // This is the ONLY cooldown gate — the previous in-memory Map was removed
      // because it resets on every Render free-tier restart.
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data: recentAlerts } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('id')
        .eq('user_id', userId)
        .eq('outreach_type', 'proactive_weather')
        .gte('created_at', twelveHoursAgo);

      if (recentAlerts && recentAlerts.length > 0) {
        logger.info(`[WeatherWatcher] Cooldown active — weather alert already sent in last 12h`, { userId });
        return; // Already alerted this weather event
      }

      // ── TOPIC-LEVEL DEDUP: check if Nova already mentioned weather recently ──
      // Catches cases where NACE or another engine already discussed the weather
      // in the last 6 hours, even without a 'proactive_weather' log entry.
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recentWeatherMsgs } = await supabaseAdmin
        .from('chat_history')
        .select('content')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .gte('created_at', sixHoursAgo)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentWeatherMsgs && recentWeatherMsgs.length > 0) {
        const weatherKeywords = ['weather', 'rain', 'raining', 'thunderstorm', 'umbrella', 'storm', 'temperature', 'baarish', 'garmi', 'thand'];
        const alreadyTalkedWeather = recentWeatherMsgs.some(msg =>
          weatherKeywords.some(kw => msg.content.toLowerCase().includes(kw))
        );
        if (alreadyTalkedWeather) {
          logger.info(`[WeatherWatcher] Topic dedup — weather already mentioned in recent chat`, { userId });
          return;
        }
      }

      // 3. Generate a hyper-realistic alert message
      const prompt = `You are Nova, an AI companion. You're proactively texting your friend because you just noticed the weather in their area (${location}).
Current conditions: ${temp}°C, Wind: ${windSpeed}km/h.
Notable: ${isRaining ? 'Raining' : ''} ${isThunderstorm ? 'Thunderstorm' : ''} ${isExtremeHeat ? 'Extreme Heat' : ''} ${isExtremeCold ? 'Extreme Cold' : ''}

Write a very short, casual text message warning them or checking in. (e.g., "hey, looks like it's raining heavily out there, stay dry!" or "40 degrees today, stay hydrated!"). No emojis, no robotic phrasing. Keep it to 1 sentence.`;

      const alertMessage = await chatCompletionBackground([{ role: 'system', content: prompt }], { maxTokens: 50 });

      // ── QUOTE STRIPPING (Fix #4) ───────────────────────────────────────────
      // LLM sometimes wraps the output in quotation marks. Strip them.
      const cleanAlertMessage = alertMessage.trim().replace(/^["']|["']$/g, '').trim();

      // 4. Send the alert using the Trigger Engine.
      // Use the shared singleton so the 30 req/min rate limit is actually tracked —
      // `new NovaTriggerEngine()` starts with an empty requestTimestamps every time,
      // so the rate limit could never fire.
      const { novaTriggerEngine } = await import('./NovaTriggerEngine');

      // We pass a dummy context, ensuring 'shouldSend' passes if not in DND
      await novaTriggerEngine.scheduleMessage(userId, {
        userPresence: 'offline', // We don't care, it's a proactive alert
        lastUserMessageAt: 0,
        lastNovaReplyAt: Date.now() - 3600000, // Pretend we haven't spoken in an hour
        conversationIntensity: 'casual',
        userActivity: null,
        pendingReminders: 0,
        emotionalState: {}
      }, async () => cleanAlertMessage);

      // Record in outreach log so the 12-hour DB cooldown fires on future cron ticks
      await supabaseAdmin.from('nova_outreach_log').insert({
        user_id: userId,
        message: cleanAlertMessage,
        outreach_type: 'proactive_weather',
      });

      logger.info(`[WeatherWatcher] Fired proactive weather alert for ${userId} in ${location}`);

    } catch (e) {
      logger.error('[WeatherWatcher] Failed to run weather check', { error: e });
    }
  }
}

export const weatherWatcherService = new WeatherWatcherService();
