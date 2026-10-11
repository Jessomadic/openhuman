//! Backend-brokered OAuth integrations (`/auth/{provider}/connect`,
//! `/auth/integrations*`) on the SDK's typed `auth()` client.
//!
//! RPC names (`openhuman.auth_oauth_connect`, `auth_oauth_list_integrations`,
//! `auth_oauth_fetch_integration_tokens`, `auth_oauth_revoke_integration`,
//! `auth_oauth_fetch_client_key`) are unchanged wire contracts. They share the
//! `auth` namespace with the core's credential controllers, which stay in the
//! core.
//!
//! `auth_oauth_fetch_client_key`'s route
//! (`POST /auth/integrations/{id}/client-key`) has no typed SDK method and is
//! absent from the backend's published contract, so it rides the SDK's raw
//! request primitive.

mod handoff;
mod ops;
mod schemas;
mod types;

pub use ops::*;
pub use schemas::{all_oauth_controller_schemas, all_oauth_registered_controllers, oauth_schemas};
pub use types::{IntegrationSummary, IntegrationTokensHandoff};
