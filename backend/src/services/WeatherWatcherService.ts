import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { chatCompletion } from '../lib/nvidia';
import axios from 'axios';

// Interface for Open-Meteo Geocoding
interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export class WeatherWatcherService {
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

      // Check if we already alerted the user about weather in the last 12 hours
      // (schema columns are outreach_type/created_at — the old query errored, so the
      // 12h dedup NEVER worked and severe-weather alerts could repeat every cron tick)
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data: recentAlerts } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('id')
        .eq('user_id', userId)
        .eq('outreach_type', 'proactive_weather')
        .gte('created_at', twelveHoursAgo);

      if (recentAlerts && recentAlerts.length > 0) {
        return; // Already alerted
      }

      // 3. Generate a hyper-realistic alert message
      const prompt = `You are Nova, an AI companion. You're proactively texting your friend because you just noticed the weather in their area (${location}).
Current conditions: ${temp}°C, Wind: ${windSpeed}km/h.
Notable: ${isRaining ? 'Raining' : ''} ${isThunderstorm ? 'Thunderstorm' : ''} ${isExtremeHeat ? 'Extreme Heat' : ''} ${isExtremeCold ? 'Extreme Cold' : ''}

Write a very short, casual text message warning them or checking in. (e.g., "hey, looks like it's raining heavily out there, stay dry!" or "40 degrees today, stay hydrated!"). No emojis, no robotic phrasing. Keep it to 1 sentence.`;

      const alertMessage = await chatCompletion([{ role: 'system', content: prompt }], { maxTokens: 50 });

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
      }, async () => alertMessage.trim());

      // Log the specific weather alert type so we don't spam
      // ('proactive_weather' is added to the outreach_type CHECK in migration 026)
      await supabaseAdmin.from('nova_outreach_log').insert({
        user_id: userId,
        message: alertMessage.trim(),
        outreach_type: 'proactive_weather',
      });

      logger.info(`[WeatherWatcher] Fired proactive weather alert for ${userId} in ${location}`);

    } catch (e) {
      logger.error('[WeatherWatcher] Failed to run weather check', { error: e });
    }
  }
}

export const weatherWatcherService = new WeatherWatcherService();
