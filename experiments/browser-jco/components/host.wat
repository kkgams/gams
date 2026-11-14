(component
  (import "gams:experiment/logging" (instance $logging
    (export "log" (func (param "value" s32)))))
  (core func $log (canon lower (func $logging "log")))
  (core instance $imports (export "log" (func $log)))
  (core module $implementation
    (import "logging" "log" (func $log (param i32)))
    (memory (export "memory") 1)
    (data (i32.const 0) "Hello, ")
    (global $heap (mut i32) (i32.const 16))

    ;; Bump allocator; canonical post-return reclaims each completed call.
    (func $realloc (export "realloc")
      (param $old i32) (param $old-size i32) (param $align i32) (param $size i32)
      (result i32)
      (local $ptr i32) (local $end i64) (local $pages i32)
      global.get $heap
      local.get $align i32.const 1 i32.sub i32.add
      i32.const 0 local.get $align i32.sub i32.and
      local.tee $ptr
      i64.extend_i32_u
      local.get $size i64.extend_i32_u i64.add
      local.tee $end
      i64.const 4294967295 i64.gt_u
      if unreachable end
      local.get $end i64.const 65535 i64.add
      i64.const 16 i64.shr_u i32.wrap_i64
      memory.size i32.sub local.tee $pages
      i32.const 0 i32.gt_s
      if
        local.get $pages memory.grow
        i32.const -1 i32.eq
        if unreachable end
      end
      local.get $end i32.wrap_i64 global.set $heap
      local.get $old-size
      if
        local.get $ptr local.get $old
        local.get $old-size local.get $size
        local.get $old-size local.get $size i32.lt_u select
        memory.copy
      end
      local.get $ptr)

    (func (export "add") (param $a i32) (param $b i32) (result i32)
      local.get $a local.get $b i32.add
      call $log
      local.get $a local.get $b i32.add)

    ;; UTF-8 input/output use the canonical pointer/byte-length representation.
    ;; The string result is returned indirectly through the pair at address 8.
    (func (export "greet") (param $name i32) (param $length i32) (result i32)
      (local $result i32) (local $size i32)
      local.get $length i32.const -9 i32.gt_u
      if unreachable end
      local.get $length i32.const 8 i32.add local.set $size
      i32.const 0 i32.const 0 i32.const 1 local.get $size
      call $realloc local.set $result
      local.get $result i32.const 0 i32.const 7 memory.copy
      local.get $result i32.const 7 i32.add
      local.get $name local.get $length memory.copy
      local.get $result local.get $size i32.add i32.const 1 i32.sub
      i32.const 33 i32.store8
      i32.const 8 local.get $result i32.store
      i32.const 12 local.get $size i32.store
      i32.const 8)

    (func (export "post-return") (param i32)
      i32.const 16 global.set $heap))
  (core instance $core (instantiate $implementation
    (with "logging" (instance $imports))))
  (func (export "add") (param "a" s32) (param "b" s32) (result s32)
    (canon lift (core func $core "add")))
  (func (export "greet") (param "name" string) (result string)
    (canon lift (core func $core "greet")
      (memory $core "memory") (realloc (func $core "realloc"))
      (post-return (func $core "post-return"))))
)
