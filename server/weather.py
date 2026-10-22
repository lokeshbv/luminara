"""Cached local forecast for the screensaver, located approximately by public IP."""

from __future__ import annotations

import asyncio
import time

import aiohttp

_cached: dict | None = None
_expires = 0.0
_lock = asyncio.Lock()


async def forecast(session: aiohttp.ClientSession) -> dict:
    """Return current conditions and a three-day forecast, refreshing every 20 minutes."""
    global _cached, _expires
    if _cached and time.monotonic() < _expires:
        return _cached
    async with _lock:
        if _cached and time.monotonic() < _expires:
            return _cached
        timeout = aiohttp.ClientTimeout(total=8)
        async with session.get("https://ipwho.is/", timeout=timeout) as response:
            response.raise_for_status()
            place = await response.json()
        if not place.get("success") or place.get("latitude") is None or place.get("longitude") is None:
            raise ValueError("Approximate location is unavailable")
        params = {
            "latitude": place["latitude"], "longitude": place["longitude"],
            "current": "temperature_2m,apparent_temperature,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "forecast_days": 3, "timezone": "auto",
        }
        async with session.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=timeout) as response:
            response.raise_for_status()
            data = await response.json()
        current, daily = data["current"], data["daily"]
        result = {
            "place": ", ".join(filter(None, [place.get("city"), place.get("region_code") or place.get("region")])),
            "temperature": round(current["temperature_2m"]),
            "feels_like": round(current["apparent_temperature"]),
            "code": current["weather_code"],
            "days": [{"date": daily["time"][i], "code": daily["weather_code"][i],
                      "high": round(daily["temperature_2m_max"][i]), "low": round(daily["temperature_2m_min"][i])}
                     for i in range(len(daily["time"]))],
        }
        _cached, _expires = result, time.monotonic() + 20 * 60
        return result
