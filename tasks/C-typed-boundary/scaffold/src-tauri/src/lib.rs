//! Field survey backend. This side is correct and must not change.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Builder, Runtime, State};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Habitat {
    Wetland,
    Grassland,
    Woodland,
    Coastal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Coordinates {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: u32,
    pub name: String,
    pub habitat: Habitat,
    pub coordinates: Coordinates,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: u32,
    pub site_id: u32,
    pub species: String,
    pub count: u32,
    /// RFC 3339 timestamp with offset, e.g. "2026-05-01T06:30:00Z".
    pub observed_at: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewObservation {
    pub site_id: u32,
    pub species: String,
    pub count: u32,
    pub observed_at: String,
    pub notes: Option<String>,
}

#[derive(Default)]
pub struct Survey {
    pub sites: Vec<Site>,
    pub observations: Mutex<Vec<Observation>>,
}

#[tauri::command]
fn get_site(survey: State<'_, Survey>, site_id: u32) -> Result<Site, String> {
    survey.sites.iter().find(|s| s.id == site_id).cloned().ok_or_else(|| format!("site {site_id} not found"))
}

/// `since` is an RFC 3339 timestamp; only observations at or after it are returned.
#[tauri::command]
fn list_observations(survey: State<'_, Survey>, site_id: u32, since: Option<String>) -> Vec<Observation> {
    survey
        .observations
        .lock()
        .unwrap()
        .iter()
        .filter(|o| o.site_id == site_id && since.as_deref().is_none_or(|s| o.observed_at.as_str() >= s))
        .cloned()
        .collect()
}

#[tauri::command]
fn record_observation(survey: State<'_, Survey>, input: NewObservation) -> Result<Observation, String> {
    if !survey.sites.iter().any(|s| s.id == input.site_id) {
        return Err(format!("site {} not found", input.site_id));
    }
    let mut all = survey.observations.lock().unwrap();
    let obs = Observation {
        id: all.len() as u32 + 1,
        site_id: input.site_id,
        species: input.species,
        count: input.count,
        observed_at: input.observed_at,
        notes: input.notes,
    };
    all.push(obs.clone());
    Ok(obs)
}

pub fn register<R: Runtime>(builder: Builder<R>, survey: Survey) -> Builder<R> {
    builder.manage(survey).invoke_handler(tauri::generate_handler![get_site, list_observations, record_observation])
}
