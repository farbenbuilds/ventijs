/// Live codecs at once, a hard limit rather than a hint: `create` reports the table full, and a slot is a word pair, so the table costs 16 bytes per codec while a message buffer is charged to its connection.
pub const codec_capacity: usize = 1024;

/// Ceiling on `maxPayload`, not a buffer: buffers are runtime-sized, so only the number width bounds this, and it is deliberately not the engine route's startup slab. `engineLimits` reports it as `maxPayloadBytes` and that one as `messageBytes`.
pub const max_message_bytes: usize = 0xffff_ffff;

/// Reassembly allocation before a peer has sent anything: 8 KiB covers a chat message and one 64 KiB read, and being too small only costs logarithmic reallocations while being too large costs the floor on every connection.
pub const message_floor: usize = 8 * 1024;

/// Outbound frame allocation before a frame is written, below the message floor because a frame is written whole and the first `encode` sizes the buffer to it.
pub const outbound_floor: usize = 1024;

/// Control events a codec may hold at once. Eight covers one 64 KiB socket read, Node's default high-water mark, and a peer that overruns it gets backpressure rather than a dropped ping.
pub const control_slots: usize = 8;

/// Ceiling on `maxFragments`, matching `ws`'s 16384, which `ws` treats as a policy failure (1008). A ceiling and not a reservation: the boundary list starts at `fragments.initial_boundaries`.
pub const max_fragments: usize = 16_384;

/// Bytes one `ingest` call copies before feeding them. A 16 KiB scratch means a 64 KiB socket read crosses the boundary four times rather than once, and the copy happens once per piece.
pub const ingest_scratch: usize = 16 * 1024;
