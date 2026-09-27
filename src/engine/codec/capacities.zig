//! The codec's compiled capacities.
//!
//! Its own module because every one of these is a policy decision with a memory
//! cost, and a reader who finds `message_capacity` in a table has to be able to
//! find out what it costs without reading the table.

/// Live codecs at once.
///
/// A slot is a word pair, not a codec: the codec itself is heap-allocated by
/// `create` and freed by `destroy`, so the table's fixed cost is `codec_capacity *
/// 16` bytes and the per-connection cost is charged to the connection rather than
/// to the process. That matters because a codec holds `max_message` bytes, and a
/// table of inlined codecs would reserve all of them at load time -- a thousand
/// slots of a 32 KiB message buffer is 32 MB resident before a single connection
/// exists, which is the difference between a limit and a bug.
///
/// The count is a limit and not a hint: past it, `create` reports the table full
/// rather than allocating, because a process that grows its codec count without
/// bound has nothing to stop it.
pub const codec_capacity: usize = 1024;

/// The largest `maxPayload` a codec may be given.
///
/// **This is a ceiling, not a buffer, and that is the whole reason it is here
/// rather than the engine route's `message_capacity`.** The codec route's buffers
/// are runtime-sized and grow to what a peer actually sends, so the only thing that
/// limits a `maxPayload` is the boundary's own number width. The engine route is
/// the opposite: its slab is carved at startup and charged to every live server, so
/// its cap is a `comptime` constant that a runtime option cannot move.
///
/// Aliasing the two used to be deliberate -- "so a payload one side accepts and the
/// other refuses is impossible" -- and it stopped being true the moment the codec's
/// buffers became growable. A codec on a 100 MiB `maxPayload` and an engine server
/// on a 64 KiB one are not the same limit disagreeing; they are two surfaces with
/// two costs, and the public surface is the codec. Sharing the number would have
/// meant either capping the codec at the engine's slab size -- which is the gap this
/// change closes -- or inflating the engine's slab to whatever a caller passed, which
/// is the memory bug the constant exists to prevent.
///
/// `engineLimits` reports both, under different names: `maxPayloadBytes` for this and
/// `messageBytes` for the engine's, so a caller reading one can tell which is which.
pub const max_message_bytes: usize = 0xffff_ffff;

/// What a codec's reassembly buffer is allocated at, before a peer has sent
/// anything. Chosen against what peers actually send rather than against the
/// ceiling: a chat or telemetry message is well under a kilobyte, Node's socket
/// high-water mark is 64 KiB, and 8 KiB covers a typical read in one allocation. A
/// connection that never receives a message never allocates past this.
///
/// The cost of getting this wrong is asymmetric. Too small costs a handful of
/// reallocations on the first few messages, which is logarithmic and therefore
/// invisible. Too large costs the floor on every connection that ever exists, which
/// is why it is 8 KiB against a 64 KiB ceiling rather than half the ceiling.
pub const message_floor: usize = 8 * 1024;

/// What a codec's outbound frame buffer is allocated at, before a frame is written.
///
/// Smaller than the message floor because a frame is written whole: the buffer is
/// sized to the frame about to be written on the first `encode`, so this only has to
/// cover the small frames that dominate, not the large ones.
pub const outbound_floor: usize = 1024;

/// Control events a codec may hold at once. Eight is enough for a single 64 KiB
/// socket read, which is Node's default high-water mark, and a peer that overruns
/// it gets backpressure rather than a silently dropped ping.
pub const control_slots: usize = 8;

/// The largest `maxFragments` a codec may be given, which is the boundary's
/// ceiling and `ws`'s default.
///
/// `ws` defaults this to 16384 and treats a larger count as a policy failure
/// (1008), not a protocol error, so matching the number is matching the contract
/// rather than picking a limit. Like the message cap it is a ceiling and not a
/// reservation: the boundary list starts at
/// `fragments.initial_boundaries` and grows to what a peer actually fragments, so
/// this number costs nothing on a connection whose messages arrive whole.
pub const max_fragments: usize = 16_384;

/// Bytes one `ingest` call copies before feeding them.
///
/// Node's default socket high-water mark is 64 KiB, so a scratch at 16 KiB means a
/// typical read crosses the boundary four times rather than once, and the copy
/// happens once per piece rather than once per frame. Raising it trades stack for
/// boundary crossings, and 16 KiB is the point where the copy cost has flattened
/// out on both sides.
pub const ingest_scratch: usize = 16 * 1024;
