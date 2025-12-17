;; vault.clar
;;
;; ============================================
;; title: vault
;; version: 1
;; summary: A simple timelock smart contract for Stacks blockchain.
;; description: Lock STX and only withdraw after a specified block height.
;; ============================================

;; traits
;;
;; ============================================
;; token definitions
;;
;; ============================================
;; constants
;;
;; Counter Error Codes
(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_UNDERFLOW (err u101))

;; Vault Error Codes
(define-constant ERR_INVALID_BLOCK (err u102))
(define-constant ERR_TOO_EARLY (err u103))
(define-constant ERR_NO_FUNDS (err u104))
(define-constant ERR_TRANSFER_FAILED (err u105))


;; ============================================
;; data vars
;;
;; Counter for general testing (as requested)
(define-data-var counter uint u0)

;; ============================================
;; data maps
;;
;; Map to store vault details: key=principal, value={balance, unlock-block}
(define-map user-vault
  principal
  {
    balance: uint,
    unlock-block: uint
  }
)

;; ============================================
;; public functions
;;

;; --- Counter Functions (for initial testing) ---

;; Public function to increment the counter
(define-public (increment)
  (let
    ((new-value (+ (var-get counter) u1)))
    (begin
      (var-set counter new-value)
      (print {
        event: "counter-incremented",
        caller: tx-sender,
        new-value: new-value,
        block-height: block-height
      })
      (ok new-value)
    )
  )
)

;; Public function to decrement the counter
(define-public (decrement)
  (let 
    ((current-value (var-get counter))
     (new-value (- current-value u1)))
    (begin
      ;; Prevent underflow
      (asserts! (> current-value u0) ERR_UNDERFLOW)
      (var-set counter new-value)
      (print {
        event: "counter-decremented",
        caller: tx-sender,
        new-value: new-value,
        block-height: block-height
      })
      (ok new-value)
    )
  )
)

;; --- Vault Core Functions ---

(define-public (deposit (amount uint) (unlock-block uint))
  (let (
      (current-block block-height)
      (user-data (map-get? user-vault tx-sender))
      (vault-info
        (match user-data
          val val
          {balance: u0, unlock-block: u0}
        )
      )
      (new-balance (+ (get balance vault-info) amount))
      (final-unlock-block
        (if (is-eq (get unlock-block vault-info) u0)
          ;; If first deposit, use new unlock-block
          unlock-block
          ;; If subsequent deposit, ensure new lock is not earlier than old lock
          (if (> unlock-block (get unlock-block vault-info))
            unlock-block
            (get unlock-block vault-info)
          )
        )
      )
    )
    (begin
      ;; 1. Input Validation: Check if the unlock block is in the future
      (asserts! (> unlock-block current-block) ERR_INVALID_BLOCK)

      ;; 2. Token Transfer: Transfer STX from user to this contract
      (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))

      ;; 3. Update Storage
      (map-set user-vault tx-sender
        {
          balance: new-balance,
          unlock-block: final-unlock-block
        }
      )

      ;; 4. Emit Event
      (print {
        event: "deposit",
        user: tx-sender,
        amount: amount,
        new-balance: new-balance,
        unlock-block: final-unlock-block,
        current-block: current-block
      })

      (ok true)
    )
  )
)

(define-public (withdraw)
  (let (
      (current-block block-height)
      (vault-info (unwrap! (map-get? user-vault tx-sender) ERR_NO_FUNDS))
      (user-balance (get balance vault-info))
      (unlock-time (get unlock-block vault-info))
      (recipient tx-sender)
    )
    (begin
      ;; 1. Authorization: Ensure caller has funds
      (asserts! (> user-balance u0) ERR_NO_FUNDS)

      ;; 2. Timelock Check: Assert that the unlock block has been reached
      (asserts! (>= current-block unlock-time) ERR_TOO_EARLY)

      ;; 3. Clear Storage BEFORE transfer to prevent reentrancy
      (map-set user-vault tx-sender
        {balance: u0, unlock-block: u0}
      )

      ;; 4. Token Transfer: Transfer STX from contract back to user
      (try! (as-contract (stx-transfer? user-balance tx-sender recipient)))

      ;; 5. Emit Event
      (print {
        event: "withdraw",
        user: tx-sender,
        amount: user-balance,
        unlock-block: unlock-time,
        current-block: current-block
      })

      (ok user-balance)
    )
  )
)

;; ============================================
;; read only functions
;;

;; Read-only function to get the current counter value (for initial testing)
(define-read-only (get-counter)
  (ok (var-get counter))
)

;; Read-only function to get the current block height (as requested in README)
(define-read-only (get-current-block)
  (ok block-height)
)

;; Read-only function to get a user's vault info
(define-read-only (get-vault-info (user principal))
  (match (map-get? user-vault user)
    val (ok val)
    ;; Return a zeroed-out vault if no data is found
    (ok {balance: u0, unlock-block: u0})
  )
)

;; ============================================
;; private functions
;;