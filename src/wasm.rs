//! A serialization boundary only: the Worker calls the same pure tree as native.

use std::path::Path;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn evaluate(snapshot: &str, path: Option<String>) -> Result<String, JsError> {
	let snapshot = serde_json::from_str(snapshot)?;
	let result = crate::tree::evaluate(&snapshot, path.as_deref().map(Path::new))
		.map_err(|error| JsError::new(&error.to_string()))?;
	Ok(serde_json::to_string(&result)?)
}

#[wasm_bindgen(js_name = removeClaim)]
pub fn remove_claim(content: &str) -> Result<String, JsError> {
	crate::claim::remove(content).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen(js_name = isClaimAddition)]
pub fn is_claim_addition(before: &str, after: &str) -> Result<bool, JsError> {
	crate::claim::is_addition(before, after).map_err(|error| JsError::new(&error.to_string()))
}
