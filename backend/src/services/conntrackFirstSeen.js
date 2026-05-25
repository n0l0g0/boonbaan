// Tracks "first seen" timestamp (ms) per conntrack entry id.
// Shared between deviceusage.service (writer from periodic sampling) and
// devices.service (reader/writer from on-demand getDeviceConnections).
// In its own module to avoid a require cycle between the two services.

const firstSeenByConnId = new Map();

function touchFirstSeen(id, now = Date.now()) {
  if (!id) return;
  if (!firstSeenByConnId.has(id)) firstSeenByConnId.set(id, now);
}

function getFirstSeen(id) {
  return firstSeenByConnId.get(id) || null;
}

function deleteId(id) {
  firstSeenByConnId.delete(id);
}

// Drop ids not in the given Set
function reconcile(activeIds) {
  for (const id of firstSeenByConnId.keys()) {
    if (!activeIds.has(id)) firstSeenByConnId.delete(id);
  }
}

module.exports = { touchFirstSeen, getFirstSeen, deleteId, reconcile };
