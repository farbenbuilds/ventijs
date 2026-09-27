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

/// The largest reassembled message a codec accepts. The same constant the engine
/// route uses, so a payload one side accepts and the other refuses is impossible.
pub const max_message_bytes: usize = @import("../server/capacities.zig").message_capacity;

/// Control events a codec may hold at once. Eight is enough for a single 64 KiB
/// socket read, which is Node's default high-water mark, and a peer that overruns
/// it gets backpressure rather than a silently dropped ping.
pub const control_slots: usize = 8;

/// Fragments one message may be split into, which is the boundary's `maxFragments`.
///
/// `ws` defaults this to 16384 and treats a larger count as a policy failure
/// (1008), not a protocol error, so matching the number is matching the contract
/// rather than picking a limit. The cost is four bytes per fragment per connection,
/// and the list is what lets a caller asking for `binaryType: 'fragments'` slice the
/// reassembled message without a second copy, so it is not a cost spent only on
/// the cap: it is the only place the fragment boundaries exist.
pub const max_fragments: usize = 16_384;

/// Bytes one `ingest` call copies before feeding them.
///
/// Node's default socket high-water mark is 64 KiB, so a scratch at 16 KiB means a
/// typical read crosses the boundary four times rather than once, and the copy
/// happens once per piece rather than once per frame. Raising it trades stack for
/// boundary crossings, and 16 KiB is the point where the copy cost has flattened
/// out on both sides.
pub const ingest_scratch: usize = 16 * 1024;
