const API_ARCHIVE_BASE_URL = "https://www.cbr-xml-daily.ru/archive";
const DEFAULT_CARD_CURRENCIES = new Set(["USD", "EUR", "CNY"]);
const REQUEST_TIMEOUT_MS = 10_000;

const dateInput = document.querySelector("#rate-date");
const previousDateButton = document.querySelector("#previous-date");
const nextDateButton = document.querySelector("#next-date");
const rateDateInfo = document.querySelector("#rate-date-info");
const currencyList = document.querySelector("#currency-list");
const fromCurrencySelect = document.querySelector("#from-currency");
const toCurrencySelect = document.querySelector("#to-currency");
const rateCards = document.querySelector("#rate-cards");
const selectedCurrencyChips = document.querySelector("#selected-currency-chips");
const currencyPickerToggle = document.querySelector("#currency-picker-toggle");
const currencyOptions = document.querySelector("#currency-options");
const amountInput = document.querySelector("#amount");
const swapCurrenciesButton = document.querySelector("#swap-currencies");
const conversionResult = document.querySelector("#conversion-result");
const conversionDetails = document.querySelector(".result__content p");

const sourceAmountFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 6,
});
const resultAmountFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 4,
});
const readableDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

let availableRates = new Map();
let actualRateDate = "";
let activeRequestController = null;
let requestNumber = 0;
let selectedCardCurrencyCodes = null;

function getUnitRate(currencyCode) {
  const currency = availableRates.get(currencyCode);

  if (
    !currency ||
    !Number.isFinite(currency.Value) ||
    !Number.isFinite(currency.Nominal) ||
    currency.Nominal <= 0
  ) {
    return null;
  }

  return currency.Value / currency.Nominal;
}

function calculateConversion(amount, fromCurrencyCode, toCurrencyCode) {
  const fromUnitRate = getUnitRate(fromCurrencyCode);
  const toUnitRate = getUnitRate(toCurrencyCode);

  if (fromUnitRate === null || toUnitRate === null || toUnitRate === 0) {
    return null;
  }

  const amountInRubles = amount * fromUnitRate;
  const result = amountInRubles / toUnitRate;

  return Number.isFinite(result) ? result : null;
}

function setConversionResult(message, details) {
  conversionResult.textContent = message;

  if (conversionDetails) {
    conversionDetails.textContent = details;
  }
}

function updateConversionResult() {
  if (availableRates.size === 0) {
    setConversionResult(
      "Курсы ещё не загружены",
      "Выберите доступную дату курса для расчёта",
    );
    return;
  }

  const rawAmount = amountInput.value.trim();

  if (rawAmount === "") {
    setConversionResult(
      "Введите сумму",
      "Укажите сумму и выберите валюты для пересчёта",
    );
    return;
  }

  const amount = Number(rawAmount);

  if (!Number.isFinite(amount) || amount < 0) {
    setConversionResult(
      "Введите корректную сумму",
      "Допустимы ноль и положительные числа",
    );
    return;
  }

  const fromCurrencyCode = fromCurrencySelect.value;
  const toCurrencyCode = toCurrencySelect.value;
  const result = calculateConversion(
    amount,
    fromCurrencyCode,
    toCurrencyCode,
  );

  if (result === null) {
    setConversionResult(
      "Не удалось выполнить расчёт",
      "Проверьте выбранные валюты",
    );
    return;
  }

  const unitResult = calculateConversion(
    1,
    fromCurrencyCode,
    toCurrencyCode,
  );
  const resultText = `${sourceAmountFormatter.format(amount)} ${fromCurrencyCode} = ${resultAmountFormatter.format(result)} ${toCurrencyCode}`;
  const detailsText = `1 ${fromCurrencyCode} = ${resultAmountFormatter.format(unitResult)} ${toCurrencyCode}`;

  setConversionResult(resultText, detailsText);
}

function formatLocalDate(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);

  if (!match) {
    throw new Error("Некорректная дата");
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const monthIndex = Number(monthValue) - 1;
  const day = Number(dayValue);
  const date = new Date(year, monthIndex, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    throw new Error("Некорректная дата");
  }

  return date;
}

function shiftCalendarDate(dateValue, dayOffset) {
  const date = parseLocalDate(dateValue);
  date.setDate(date.getDate() + dayOffset);

  return formatLocalDate(date);
}

function updateDateNavigationState() {
  nextDateButton.disabled =
    !dateInput.value || dateInput.value >= dateInput.max;
}

function updateRateDateInfo(state = "selected") {
  if (state === "timeout") {
    rateDateInfo.textContent =
      "Не удалось получить данные: превышено время ожидания.";
    return;
  } else if (state === "error") {
    rateDateInfo.textContent = "Архив за эту дату недоступен.";
    return;
  }

  rateDateInfo.textContent = "";
}

function changeSelectedDate(dayOffset) {
  const nextDateValue = shiftCalendarDate(dateInput.value, dayOffset);

  if (nextDateValue > dateInput.max) {
    return;
  }

  dateInput.value = nextDateValue;
  updateDateNavigationState();
  updateRateDateInfo();
  loadRates(nextDateValue);
}

function buildArchiveUrl(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);

  if (!match) {
    throw new Error("Некорректная дата");
  }

  const [, year, month, day] = match;
  return `${API_ARCHIVE_BASE_URL}/${year}/${month}/${day}/daily_json.js`;
}

function createOption(currency, isSelected = false) {
  const option = document.createElement("option");
  option.value = currency.CharCode;
  option.textContent = `${currency.Name} (${currency.CharCode})`;
  option.selected = isSelected;

  return option;
}

function setCurrencyMenuOpen(isOpen) {
  currencyOptions.hidden = !isOpen;
  currencyPickerToggle.setAttribute("aria-expanded", String(isOpen));
}

function updateCurrencySelection(code, isSelected) {
  const option = Array.from(currencyList.options).find(
    (currencyOption) => currencyOption.value === code,
  );

  if (!option) {
    return;
  }

  option.selected = isSelected;
  currencyList.dispatchEvent(new Event("change"));
}

function renderCurrencyOptions(currencies, selectedCodes) {
  const optionsFragment = document.createDocumentFragment();

  currencies.forEach((currency) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "currency-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = currency.CharCode;
    checkbox.dataset.currencyCode = currency.CharCode;
    checkbox.checked = selectedCodes.has(currency.CharCode);
    checkbox.addEventListener("change", () => {
      updateCurrencySelection(currency.CharCode, checkbox.checked);
    });

    const code = document.createElement("span");
    code.className = "currency-option__code";
    code.textContent = currency.CharCode;

    const name = document.createElement("span");
    name.className = "currency-option__name";
    name.textContent = currency.Name;

    optionLabel.append(checkbox, code, name);
    optionsFragment.append(optionLabel);
  });

  currencyOptions.replaceChildren(optionsFragment);
}

function renderSelectedCurrencyChips() {
  const chipsFragment = document.createDocumentFragment();
  const selectedOptions = Array.from(currencyList.selectedOptions);

  if (selectedOptions.length === 0) {
    const emptyMessage = document.createElement("span");
    emptyMessage.className = "currency-picker__empty";
    emptyMessage.textContent = "Валюты не выбраны";
    chipsFragment.append(emptyMessage);
  }

  selectedOptions.forEach((option) => {
    const chip = document.createElement("span");
    chip.className = "currency-chip";
    chip.textContent = option.value;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Удалить валюту ${option.value}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      updateCurrencySelection(option.value, false);
    });

    chip.append(removeButton);
    chipsFragment.append(chip);
  });

  selectedCurrencyChips.replaceChildren(chipsFragment);
}

function syncCurrencyPicker() {
  const selectedCodes = new Set(
    Array.from(currencyList.selectedOptions, (option) => option.value),
  );

  currencyOptions.querySelectorAll("input[data-currency-code]").forEach((checkbox) => {
    checkbox.checked = selectedCodes.has(checkbox.dataset.currencyCode);
  });

  renderSelectedCurrencyChips();
}

function saveSelectedCurrencyCodes() {
  selectedCardCurrencyCodes = new Set(
    Array.from(currencyList.selectedOptions, (option) => option.value),
  );
}

function getDefaultSelectedCurrencyCodes(currencies) {
  const availableCodes = new Set(
    currencies.map((currency) => currency.CharCode),
  );
  const selectedCodes = new Set(
    Array.from(DEFAULT_CARD_CURRENCIES).filter((code) =>
      availableCodes.has(code),
    ),
  );

  for (const currency of currencies) {
    if (selectedCodes.size >= 3) {
      break;
    }

    selectedCodes.add(currency.CharCode);
  }

  return selectedCodes;
}

function restoreSelectedCurrencyCodes(currencies) {
  const availableCodes = new Set(
    currencies.map((currency) => currency.CharCode),
  );
  const restoredCodes = new Set(
    selectedCardCurrencyCodes === null
      ? []
      : Array.from(selectedCardCurrencyCodes).filter((code) =>
          availableCodes.has(code),
        ),
  );

  selectedCardCurrencyCodes =
    restoredCodes.size > 0
      ? restoredCodes
      : getDefaultSelectedCurrencyCodes(currencies);

  return selectedCardCurrencyCodes;
}

function showRateMessage(message) {
  const status = document.createElement("p");
  status.className = "rate-status";
  status.textContent = message;
  rateCards.replaceChildren(status);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 10,
  }).format(value);
}

function formatResponseDate(dateValue) {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return readableDateFormatter.format(date);
}

function createRateCard(currency) {
  const card = document.createElement("article");
  const currencyCode = currency.CharCode.toLowerCase();
  const accentCodes = new Set(["usd", "eur", "cny"]);
  const accentClass = accentCodes.has(currencyCode)
    ? `rate-card--${currencyCode}`
    : "rate-card--default";
  card.classList.add("rate-card", accentClass);

  const header = document.createElement("div");
  header.className = "rate-card__header";

  const currencySymbols = {
    USD: "$",
    EUR: "€",
    CNY: "¥",
  };
  const symbol = document.createElement("span");
  symbol.className = "rate-card__symbol";
  symbol.textContent = currencySymbols[currency.CharCode] || "¤";

  const identity = document.createElement("div");
  identity.className = "rate-card__identity";

  const code = document.createElement("h3");
  code.className = "rate-card__code";
  code.textContent = currency.CharCode;

  const name = document.createElement("p");
  name.className = "rate-card__name";
  name.textContent = currency.Name;

  const value = document.createElement("p");
  value.className = "rate-card__value";
  value.textContent = `${formatNumber(currency.Value)} ₽`;

  const nominal = document.createElement("p");
  nominal.className = "rate-card__nominal";
  nominal.textContent = `за ${currency.Nominal} ${currency.CharCode}`;

  const date = document.createElement("p");
  date.className = "rate-card__date";
  date.textContent = `Дата курса: ${formatResponseDate(actualRateDate)}`;

  const chart = document.createElement("div");
  chart.className = "rate-card__chart";
  chart.setAttribute("aria-hidden", "true");

  identity.append(code, name);
  header.append(symbol, identity);
  card.append(header, value, nominal, chart, date);
  return card;
}

function renderSelectedRates() {
  const selectedCodes = Array.from(
    currencyList.selectedOptions,
    (option) => option.value,
  );

  if (selectedCodes.length === 0) {
    showRateMessage("Выберите хотя бы одну валюту для отображения курса.");
    return;
  }

  const cards = document.createDocumentFragment();

  selectedCodes.forEach((code) => {
    const currency = availableRates.get(code);

    if (currency) {
      cards.append(createRateCard(currency));
    }
  });

  rateCards.replaceChildren(cards);
}

function fillCurrencyList(currencies) {
  const selectedCodes = restoreSelectedCurrencyCodes(currencies);
  const options = currencies.map((currency) =>
    createOption(currency, selectedCodes.has(currency.CharCode)),
  );

  currencyList.replaceChildren(...options);
  renderCurrencyOptions(currencies, selectedCodes);
  syncCurrencyPicker();
}

function fillConverterSelects(currencies) {
  const ruble = {
    CharCode: "RUB",
    Name: "Российский рубль",
    Nominal: 1,
    Value: 1,
  };
  const currenciesWithRuble = [ruble, ...currencies];

  availableRates.set(ruble.CharCode, ruble);

  const fromOptions = currenciesWithRuble.map((currency) =>
    createOption(currency, currency.CharCode === "EUR"),
  );
  const toOptions = currenciesWithRuble.map((currency) =>
    createOption(currency, currency.CharCode === "RUB"),
  );

  fromCurrencySelect.replaceChildren(...fromOptions);
  toCurrencySelect.replaceChildren(...toOptions);
}

function resetLoadedData() {
  availableRates = new Map();
  actualRateDate = "";
  currencyList.replaceChildren();
  currencyOptions.replaceChildren();
  renderSelectedCurrencyChips();
  fromCurrencySelect.replaceChildren();
  toCurrencySelect.replaceChildren();
  updateConversionResult();
}

function getCurrencies(responseData) {
  if (!responseData || typeof responseData.Valute !== "object") {
    throw new Error("Ответ сервера не содержит данные о валютах");
  }

  return Object.values(responseData.Valute).filter(
    (currency) =>
      currency &&
      typeof currency.CharCode === "string" &&
      typeof currency.Name === "string" &&
      Number.isFinite(currency.Value) &&
      Number.isFinite(currency.Nominal),
  );
}

async function loadRates(dateValue) {
  activeRequestController?.abort();

  const controller = new AbortController();
  const currentRequestNumber = ++requestNumber;
  let timeoutReached = false;
  const timeoutId = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  activeRequestController = controller;

  resetLoadedData();
  updateRateDateInfo();
  showRateMessage("Загружаем курсы валют…");

  try {
    const response = await fetch(buildArchiveUrl(dateValue), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Сервер вернул ошибку ${response.status}`);
    }

    const responseData = await response.json();
    const currencies = getCurrencies(responseData);

    if (currencies.length === 0) {
      throw new Error("Список валют в ответе пуст");
    }

    if (currentRequestNumber !== requestNumber) {
      return;
    }

    actualRateDate = responseData.Date || dateValue;
    availableRates = new Map(
      currencies.map((currency) => [currency.CharCode, currency]),
    );

    fillCurrencyList(currencies);
    fillConverterSelects(currencies);
    renderSelectedRates();
    updateConversionResult();
    updateRateDateInfo("success");
  } catch (error) {
    if (currentRequestNumber !== requestNumber) {
      return;
    }

    if (timeoutReached) {
      resetLoadedData();
      showRateMessage(
        "Сервис курсов временно не отвечает. Попробуйте ещё раз или выберите другую дату.",
      );
      updateRateDateInfo("timeout");
      return;
    }

    if (error.name === "AbortError") {
      return;
    }

    resetLoadedData();
    showRateMessage(
      "Архив за выбранную дату недоступен. Выберите предыдущий рабочий день.",
    );
    updateRateDateInfo("error");
    console.warn("Не удалось загрузить архив курсов валют:", error);
  } finally {
    clearTimeout(timeoutId);

    if (activeRequestController === controller) {
      activeRequestController = null;
    }
  }
}

currencyList.addEventListener("change", () => {
  saveSelectedCurrencyCodes();
  syncCurrencyPicker();
  renderSelectedRates();
});

currencyPickerToggle.addEventListener("click", () => {
  setCurrencyMenuOpen(currencyOptions.hidden);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".currency-picker")) {
    setCurrencyMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !currencyOptions.hidden) {
    setCurrencyMenuOpen(false);
    currencyPickerToggle.focus();
  }
});

dateInput.addEventListener("change", () => {
  if (dateInput.value) {
    if (dateInput.value > dateInput.max) {
      dateInput.value = dateInput.max;
    }

    updateDateNavigationState();
    updateRateDateInfo();
    loadRates(dateInput.value);
  }
});

previousDateButton.addEventListener("click", () => {
  changeSelectedDate(-1);
});

nextDateButton.addEventListener("click", () => {
  changeSelectedDate(1);
});

amountInput.addEventListener("input", updateConversionResult);
fromCurrencySelect.addEventListener("change", updateConversionResult);
toCurrencySelect.addEventListener("change", updateConversionResult);

swapCurrenciesButton.addEventListener("click", () => {
  const fromCurrencyCode = fromCurrencySelect.value;
  fromCurrencySelect.value = toCurrencySelect.value;
  toCurrencySelect.value = fromCurrencyCode;
  updateConversionResult();
});

const today = formatLocalDate(new Date());
dateInput.max = today;
dateInput.value = today;
updateDateNavigationState();
updateRateDateInfo();
loadRates(today);
