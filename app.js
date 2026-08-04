const API_ARCHIVE_BASE_URL = "https://www.cbr-xml-daily.ru/archive";
const DEFAULT_CARD_CURRENCIES = new Set(["USD", "EUR", "CNY"]);

const dateInput = document.querySelector("#rate-date");
const currencyList = document.querySelector("#currency-list");
const fromCurrencySelect = document.querySelector("#from-currency");
const toCurrencySelect = document.querySelector("#to-currency");
const rateCards = document.querySelector("#rate-cards");

let availableRates = new Map();
let actualRateDate = "";
let activeRequestController = null;
let requestNumber = 0;

function formatLocalDate(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function createRateCard(currency) {
  const card = document.createElement("article");
  card.className = "rate-card";

  const code = document.createElement("h3");
  code.textContent = currency.CharCode;

  const name = document.createElement("p");
  name.textContent = currency.Name;

  const value = document.createElement("p");
  value.textContent = `${formatNumber(currency.Value)} ₽`;

  const nominal = document.createElement("p");
  nominal.textContent = `за ${currency.Nominal} ${currency.CharCode}`;

  const date = document.createElement("p");
  date.textContent = `Дата курса: ${formatResponseDate(actualRateDate)}`;

  card.append(code, name, value, nominal, date);
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
  const options = currencies.map((currency) =>
    createOption(currency, DEFAULT_CARD_CURRENCIES.has(currency.CharCode)),
  );

  currencyList.replaceChildren(...options);
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
  fromCurrencySelect.replaceChildren();
  toCurrencySelect.replaceChildren();
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
  activeRequestController = controller;

  resetLoadedData();
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
  } catch (error) {
    if (error.name === "AbortError" || currentRequestNumber !== requestNumber) {
      return;
    }

    resetLoadedData();
    showRateMessage(
      "Не удалось загрузить курсы на выбранную дату. Проверьте дату и подключение к интернету.",
    );
    console.error("Ошибка загрузки курсов валют:", error);
  } finally {
    if (activeRequestController === controller) {
      activeRequestController = null;
    }
  }
}

currencyList.addEventListener("change", renderSelectedRates);

dateInput.addEventListener("change", () => {
  if (dateInput.value) {
    loadRates(dateInput.value);
  }
});

const today = formatLocalDate(new Date());
dateInput.max = today;
dateInput.value = today;
loadRates(today);
