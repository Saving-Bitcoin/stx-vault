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
  (begin
    (var-set counter (+ (var-get counter) u1))
    (ok (var-get counter))
  )
)

;; Public function to decrement the counter
(define-public (decrement)
  (let 
    ((current-value (var-get counter)))
    (begin
      ;; Prevent underflow
      (asserts! (> current-value u0) ERR_UNDERFLOW)
      (var-set counter (- current-value u1))
      (ok (var-get counter))
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
          unlock-block: 
            (if (is-eq (get unlock-block vault-info) u0)
              ;; If first deposit, use new unlock-block
              unlock-block
              ;; If subsequent deposit, ensure new lock is not earlier than old lock
              (if (> unlock-block (get unlock-block vault-info))
                unlock-block
                (get unlock-block vault-info)
              )
            )
        }
      )

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
    )
    (begin
      ;; 1. Authorization: Ensure caller has funds
      (asserts! (> user-balance u0) ERR_NO_FUNDS)

      ;; 2. Timelock Check: Assert that the unlock block has been reached
      (asserts! (>= current-block unlock-time) ERR_TOO_EARLY)

      ;; 3. Token Transfer: Transfer STX from contract back to user
      (try! (as-contract (stx-transfer? user-balance tx-sender contract-caller)))

      ;; 4. Clear Storage
      (map-set user-vault tx-sender
        {balance: u0, unlock-block: u0}
      )

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