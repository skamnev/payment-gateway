import express from "express";
import bodyParser from "body-parser";

const paymentGateway = express(),
  gatewayPort = 3000;

paymentGateway.use(bodyParser.json());

let shops = {}, // Shops temporary DB
  payments = {}, // Payments temporary DB
  paymentIdIncrement = 0, // Payment ID Increment as a DB ID Key
  shopIdIncrement = 0, // Shop ID Increment as a DB ID Key
  paymentGatewayBlockSum = 0,
  commissions = {
    A: 0,
    B: 0,
  };

const PAYMENT_ACCEPTED = 1,
  PAYMENT_PROCESSED = 2,
  PAYMENT_COMPLETED = 3,
  PAYMENT_WITHDRAWN = 4;

/**
 * Updates the status of payments.
 *
 * @param {Array<string>} paymentIds - An array of payment IDs to update.
 * @param {string} currentStatus - The current status that must match for the update to occur.
 * @param {string} newStatus - The new status to set for payments.
 */
function updateStatus(paymentIds, currentStatus, newStatus) {
  paymentIds.forEach((id) => {
    if (payments[id] && payments[id].status === currentStatus) {
      payments[id].status = newStatus;
    }
  });
}

/**
 * Validates the commission settings.
 * @param {number} number - The number object to be validated.
 * @returns {boolean} - Returns true if valid, otherwise false.
 */
function isNumber(number) {
  const numberValue = Number(number);

  // Check if commissionA is a valid number and greater than 0
  if (isNaN(numberValue) || numberValue <= 0) {
    return false;
  }

  return true;
}

/**
 * Checks if a string is empty or contains only whitespace characters.
 *
 * @param {string} str - The string to be checked.
 * @returns {boolean} - Returns true if the string is empty or whitespace, otherwise false.
 */
function isEmpty(str) {
  return !str || str.trim().length === 0;
}

/**
 * Validates an array of payment IDs.
 *
 * @param {Array<any>} paymentIds - An array of payment IDs to validate.
 * @returns {boolean} - Returns true if all payment IDs are valid numbers, otherwise false.
 */
function validatePaymentIDs(paymentIds) {
  paymentIds.forEach((id) => {
    if (!isNumber(id)) {
      return false;
    }
  });

  return true;
}

/**
 * Validates if the current date is greater than or equal to one day after the given payout date.
 *
 * @param {Date|string} dateValue - The date value to check. This can be a Date object or a date string in a recognized format.
 * @returns {boolean} - Returns true if the current date is greater than or equal to one day after the given payout date, otherwise returns false.
 */
function validatePayoutDate(dateValue) {
  const lastPayoutPlusOneDay = new Date(dateValue),
    currentDate = new Date();
  lastPayoutPlusOneDay.setDate(lastPayoutPlusOneDay.getDate() + 1);

  return currentDate >= lastPayoutPlusOneDay;
}

/**
 * Retrieves the current date without the time component.
 *
 * @returns {string} The current date formatted as 'YYYY-MM-DD'.
 */
function getCurrentDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * @route POST /api/settings
 * @param {Settings} settings.body.required - Object containing commission and blocking sum settings.
 * @param {number} settings.body.commissionA.required - The commission rate for option A.
 * @param {number} settings.body.commissionB.required - The commission rate for option B.
 * @param {number} settings.body.blockSum.required - The sum to block in the payment gateway.
 * @returns {object} 202 - Commisions and blocking sum accepted.
 * @returns {Error} 400 - If the input data is invalid.
 */
paymentGateway.post("/api/settings", (req, res) => {
  const { commissionA, commissionB, blockSum } = req.body;

  if (!isNumber(commissionA) || !isNumber(commissionB) || !isNumber(blockSum)) {
    return res
      .status(400)
      .json({ message: "Invalid commissions or block sum settings." });
  }

  commissions.A = commissionA;
  commissions.B = commissionB;
  paymentGatewayBlockSum = blockSum;

  /** Sending back commissions and blockSum for testing purpose */
  res.status(202).json({
    commissionA: commissions.A,
    commissionB: commissions.B,
    blockSum: paymentGatewayBlockSum,
  });
});

/**
 * @route POST /api/add-shop
 * @param {Object} shop.body.required - The shop object to be added.
 * @param {string} shop.body.name.required - The name of the shop.
 * @param {number} shop.body.commissionC.required - The commission rate for the shop.
 * @returns {object} 201 - An object containing the ID of the newly added shop.
 * @returns {Error} 400 - If the input data is invalid.
 */
paymentGateway.post("/api/add-shop", (req, res) => {
  const { name, commissionC } = req.body;

  if (isEmpty(name) || !isNumber(commissionC)) {
    return res
      .status(400)
      .json({ message: "Invalid name or commision. Check your request data." });
  }

  shopIdIncrement++;
  shops[shopIdIncrement] = {
    id: shopIdIncrement,
    name: name,
    commissionC: commissionC,
    payments: [],
    lastPayout: 0,
  };
  res.status(201).json({ id: shopIdIncrement });
});

/**
 * @route POST /api/payments/accept
 * @param {Object} payment.body.required - The payment details to be processed.
 * @param {string} payment.body.shopId.required - The ID of the shop associated with the payment.
 * @param {number} payment.body.amount.required - The amount of the payment.
 * @returns {object} 202 - An object containing the ID of the payment accepted.
 * @returns {Error} 404 - If the specified shop ID is not found.
 * @returns {Error} 400 - If the input data is invalid.
 */
paymentGateway.post("/api/payments/accept", (req, res) => {
  const { shopId, amount } = req.body;

  if (!isNumber(amount) || !isNumber(shopId)) {
    return res
      .status(400)
      .json({ message: "Invalid shop ID or amount. Check your request data." });
  }

  if (!shops[shopId]) {
    return res.status(404).send("Shop not found");
  }

  paymentIdIncrement++;
  payments[paymentIdIncrement] = {
    id: paymentIdIncrement,
    shopId: shopId,
    amount: amount,
    status: PAYMENT_ACCEPTED,
    blockedAmount: (paymentGatewayBlockSum / 100) * amount,
  };

  shops[shopId].payments.push(paymentIdIncrement);
  res.status(202).json({ id: paymentIdIncrement });
});

/**
 * @route POST /api/payments/process
 * @param {Object} req.body.required - The request body containing payment IDs.
 * @param {Array<number>} req.body.paymentIds.required - An array of payment IDs to be processed.
 * @returns {object} 201 - A success message indicating that payments have been processed.
 * @returns {Error} 400 - If the array contains invalid payment IDs.
 */
paymentGateway.post("/api/payments/process", (req, res) => {
  const { paymentIds } = req.body;

  if (!validatePaymentIDs(paymentIds)) {
    return res.status(400).json({
      message: "Array contains invalid payment IDs. Check your request data.",
    });
  }

  updateStatus(paymentIds, PAYMENT_ACCEPTED, PAYMENT_PROCESSED);

  res.status(201).json({ message: "Payments processed", payments });
});

/**
 * @route POST /api/payments/complete
 * @param {Object} req.body.required - The request body containing payment IDs.
 * @param {Array<number>} req.body.paymentIds.required - An array of payment IDs to be processed.
 * @returns {object} 201 - A success message indicating that payments have been processed.
 * @returns {Error} 400 - If the array contains invalid payment IDs.
 */
paymentGateway.post("/api/payments/complete", (req, res) => {
  const { paymentIds } = req.body;

  if (!validatePaymentIDs(paymentIds)) {
    return res.status(400).json({
      message: "Array contains invalid payment IDs. Check your request data.",
    });
  }

  updateStatus(paymentIds, PAYMENT_PROCESSED, PAYMENT_COMPLETED);

  res.status(201).json({ message: "Payments completed", payments });
});

/**
 * @route POST /api/payments/withdraw
 * @param {Object} req.body.required - The request body containing the shop ID.
 * @param {number} req.body.shopId.required - The ID of the shop requesting the withdrawal.
 * @returns {object} 200 - An object containing the total payment amount, payout date and the list of withdrawn payments.
 * @returns {Error} 400 - If the provided shop ID is invalid.
 * @returns {Error} 404 - If the specified shop ID is not found.
 * @returns {Error} 409 - If the last payout date was less than 1 day ago.
 */
paymentGateway.post("/api/payments/withdraw", (req, res) => {
  const { shopId } = req.body;

  if (!isNumber(shopId)) {
    return res.status(400).json({ message: "Invalid shop ID." });
  }

  if (!shops[shopId]) {
    return res.status(404).send("Shop not found");
  }

  if (!validatePayoutDate(shops[shopId].lastPayout)) {
    return res
      .status(409)
      .send("The payout has been completed. Please come back tomorrow.");
  }

  let totalPayment = 0,
    paymentList = [];

  shops[shopId].payments.forEach((paymentId) => {
    const payment = payments[paymentId];
    if (payment && payment.status === PAYMENT_COMPLETED) {
      const netAmount =
        payment.amount -
        (commissions.A +
          (commissions.B / 100) * payment.amount +
          (shops[shopId].commissionC / 100) * payment.amount);
      totalPayment += netAmount;
      payment.status = PAYMENT_WITHDRAWN;
      paymentList.push({ id: paymentId, amount: netAmount });
    }
  });

  if (paymentList.length > 0) {
    shops[shopId].lastPayout = getCurrentDate();
  }

  res.status(200).json({
    totalPayment,
    payments: paymentList,
    lastPayout: shops[shopId].lastPayout,
  });
});

paymentGateway.listen(gatewayPort, () => {
  console.log(
    `Payment system API listening at http://localhost:${gatewayPort}`
  );
});
