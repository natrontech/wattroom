-- name: GetWorldKey :one
-- The one world key (#3225): what every world's secrets are derived from.
select key from world_key;
