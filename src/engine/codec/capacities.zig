//! The codec's compiled capacities. Every one is a policy decision with a memory
//! cost, so the table records the number and the reason, not the number alone.

/// Live codecs at once, a hard limit rather than a hint: `create` reports the table
/// full rather than allocating. A slot is a word pair because `create` heap-allocates
/// the codec, so the table costs `codec_capacity * 16` bytes while a codec's message
/// buffer is charged to its connection; inlining 1024 of them would reserve 32 MB
/// before the first connection exists.
pub const codec_capacity: usize = 1024;

/// Ceiling on `maxPayload`, not a buffer: the codec's buffers are runtime-sized and
/// grow to what a peer sends, so the only thing bounding this is the number width.
/// Deliberately *not* the engine route's `message_capacity`, whose slab is carved at
/// startup and charged to every live server. `engineLimits` reports this as
/// `maxPayloadBytes` and that one as `messageBytes`.
pub const max_message_bytes: usize = 0xffff_ffff;

/// Reassembly buffer allocation before a peer has sent anything: 8 KiB covers a
/// typical chat message and one 64 KiB socket read, and being too small only costs
/// logarithmic reallocations while being too large costs the floor on every
/// connection that ever exists.
pub const message_floor: usize = 8 * 1024;

/// Outbound frame buffer allocation before a frame is written. Below the message
/// floor because a frame is written whole, so the first `encode` sizes the buffer to
/// it and this only has to cover the small frames that dominate.
pub const outbound_floor: usize = 1024;

/// Control events a codec may hold at once. Eight covers a single 64 KiB socket
/// read, Node's default high-water mark; a peer that overruns it gets backpressure
/// rather than a silently dropped ping.
pub const control_slots: usize = 8;

/// Ceiling on `maxFragments`, matching `ws`'s default of 16384, which `ws` treats as
/// a policy failure (1008) rather than a protocol error. A ceiling and not a
/// reservation: the boundary list starts at `fragments.initial_boundaries` and
/// grows to what a peer actually fragments.
pub const max_fragments: usize = 16_384;

/// Bytes one `ingest` call copies before feeding them. A scratch at 16 KiB means a
/// typical 64 KiB socket read crosses the boundary four times rather than once, and
/// the copy happens once per piece rather than once per frame; raising it trades
/// stack for boundary crossings.
pub const ingest_scratch: usize = 16 * 1024;
